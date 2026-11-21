// Boîtier infrarouge pour climatisation : ESP32 + LED IR (+ récepteur IR optionnel).
// Sert l'application web (PWA) et une petite API JSON sur le réseau local.

#include <Arduino.h>
#include <ArduinoJson.h>
#include <ESPmDNS.h>
#include <IRac.h>
#include <IRrecv.h>
#include <IRremoteESP8266.h>
#include <IRutils.h>
#include <Preferences.h>
#include <WebServer.h>
#include <WiFi.h>
#include <WiFiManager.h>

#include <vector>

#ifndef IR_SEND_PIN
#define IR_SEND_PIN 4
#endif
#ifndef IR_RECV_PIN
#define IR_RECV_PIN 14
#endif
#ifndef HOSTNAME
#define HOSTNAME "clim"  // préfixe : clim.local, clim-chambre.local…
#endif
#define RESET_BUTTON_PIN 0  // bouton BOOT : appui 5 s = oublier le Wi-Fi

static const float kMinTemp = 16;
static const float kMaxTemp = 30;
static const uint32_t kLearnDurationMs = 30000;

// ---- Fichiers web intégrés (voir board_build.embed_* dans platformio.ini) ----
#define EMBED(name, sym)                                              \
  extern const uint8_t name##_start[] asm("_binary_" sym "_start"); \
  extern const uint8_t name##_end[] asm("_binary_" sym "_end");
EMBED(index_html, "web_index_html")
EMBED(app_js, "web_app_js")
EMBED(style_css, "web_style_css")
EMBED(manifest, "web_manifest_webmanifest")
EMBED(sw_js, "web_sw_js")
EMBED(icon_svg, "web_icon_svg")
EMBED(icon192, "web_icon_192_png")
EMBED(icon512, "web_icon_512_png")
EMBED(apple_icon, "web_apple_touch_icon_png")

// ---- État global ----
static IRac ac(IR_SEND_PIN);
#if IR_RECV_PIN >= 0
static IRrecv irrecv(IR_RECV_PIN, 1024, 50, true);
static decode_results results;
#endif
static WebServer server(80);
static Preferences prefs;

static uint32_t offAt = 0;       // millis() de l'arrêt programmé, 0 = aucun
static uint32_t learnUntil = 0;  // millis() de fin de détection, 0 = inactif
static String lastLearned;
static bool lastSendOk = true;

// ---- Plusieurs clims : un boîtier par pièce, qui se trouvent entre eux (mDNS) ----
static String roomName;  // ex. « Salon »
static String hostName;  // ex. « clim-salon » -> http://clim-salon.local
struct Peer {
  String name;
  IPAddress ip;
};
static std::vector<Peer> peers;
static uint32_t nextDiscovery = 0;
static const uint32_t kDiscoveryEveryMs = 10UL * 60 * 1000;

// ---- Conversions texte <-> énumérations ----
struct Pair {
  const char *name;
  int value;
};
static const Pair kModes[] = {{"auto", (int)stdAc::opmode_t::kAuto},
                              {"cool", (int)stdAc::opmode_t::kCool},
                              {"heat", (int)stdAc::opmode_t::kHeat},
                              {"dry", (int)stdAc::opmode_t::kDry},
                              {"fan", (int)stdAc::opmode_t::kFan}};
static const Pair kFans[] = {{"auto", (int)stdAc::fanspeed_t::kAuto},
                             {"min", (int)stdAc::fanspeed_t::kMin},
                             {"low", (int)stdAc::fanspeed_t::kLow},
                             {"medium", (int)stdAc::fanspeed_t::kMedium},
                             {"high", (int)stdAc::fanspeed_t::kHigh},
                             {"max", (int)stdAc::fanspeed_t::kMax}};

template <size_t N>
static const char *toName(const Pair (&table)[N], int value, const char *def) {
  for (const auto &p : table)
    if (p.value == value) return p.name;
  return def;
}
template <size_t N>
static bool fromName(const Pair (&table)[N], const char *name, int &out) {
  if (!name) return false;
  for (const auto &p : table)
    if (strcmp(p.name, name) == 0) {
      out = p.value;
      return true;
    }
  return false;
}

static bool active(uint32_t deadline) {
  return deadline != 0 && (int32_t)(deadline - millis()) > 0;
}

// ---- Nom de la pièce, nom réseau, découverte des autres boîtiers ----
static String slugify(String in) {
  static const char *from[] = {"É", "é", "è", "ê", "ë", "à", "â", "ä", "î", "ï", "ô", "ö", "ù", "û", "ü", "ç"};
  static const char *to[] = {"e", "e", "e", "e", "e", "a", "a", "a", "i", "i", "o", "o", "u", "u", "u", "c"};
  in.toLowerCase();
  for (size_t i = 0; i < sizeof(from) / sizeof(from[0]); i++) in.replace(from[i], to[i]);
  String out;
  for (unsigned int i = 0; i < in.length(); i++) {
    char c = in[i];
    bool ok = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9');
    if (ok) out += c;
    else if (out.length() && !out.endsWith("-")) out += '-';
  }
  while (out.endsWith("-")) out.remove(out.length() - 1);
  return out.substring(0, 24);
}

static void setRoomName(String name) {
  name.trim();
  if (name.isEmpty()) name = "Clim";
  roomName = name.substring(0, 32);
  String slug = slugify(roomName);
  hostName = (slug.isEmpty() || slug == HOSTNAME) ? String(HOSTNAME) : String(HOSTNAME) + "-" + slug;
}

static void startMdns() {
  MDNS.end();
  if (!MDNS.begin(hostName.c_str())) return;
  MDNS.addService("http", "tcp", 80);
  MDNS.addService("clim", "tcp", 80);
  MDNS.addServiceTxt("clim", "tcp", "name", roomName.c_str());
}

// Bloque ~3 s : appelé au démarrage, toutes les 10 min, ou à la demande de l'app.
static void discoverPeers() {
  int n = MDNS.queryService("clim", "tcp");
  peers.clear();
  for (int i = 0; i < n; i++) {
    IPAddress ip = MDNS.IP(i);
    if (ip == WiFi.localIP() || ip == IPAddress()) continue;
    String name = MDNS.txt(i, "name");
    if (name.isEmpty()) name = MDNS.hostname(i);
    peers.push_back({name, ip});
  }
  nextDiscovery = (millis() + kDiscoveryEveryMs) | 1;
  Serial.printf("Autres boîtiers trouvés : %d\n", (int)peers.size());
}

// ---- Persistance ----
static void saveState() { prefs.putBytes("state", &ac.next, sizeof(ac.next)); }

static void loadState() {
  if (prefs.getBytesLength("state") == sizeof(ac.next)) {
    prefs.getBytes("state", &ac.next, sizeof(ac.next));
  } else {
    ac.next.power = false;
    ac.next.mode = stdAc::opmode_t::kCool;
    ac.next.celsius = true;
    ac.next.degrees = 24;
    ac.next.fanspeed = stdAc::fanspeed_t::kAuto;
    ac.next.swingv = stdAc::swingv_t::kOff;
    ac.next.light = true;
  }
  ac.next.sleep = -1;
  ac.next.clock = -1;
  ac.markAsSent();  // l'état chargé est considéré comme celui de la clim
}

// ---- Émission infrarouge ----
enum TxResult { TX_OK, TX_SKIPPED, TX_NO_PROTOCOL, TX_FAILED };

static TxResult transmit(bool force) {
  saveState();
  if (ac.next.protocol == decode_type_t::UNKNOWN) return TX_NO_PROTOCOL;
  // Clim éteinte et qui reste éteinte : on mémorise sans émettre.
  if (!force && !ac.next.power && !ac.getStatePrev().power) return TX_SKIPPED;
#if IR_RECV_PIN >= 0
  irrecv.disableIRIn();  // ne pas se recevoir soi-même
#endif
  lastSendOk = ac.sendAc();
#if IR_RECV_PIN >= 0
  irrecv.enableIRIn();
#endif
  Serial.printf("IR %s -> %s\n", typeToString(ac.next.protocol).c_str(),
                lastSendOk ? "ok" : "ECHEC");
  return lastSendOk ? TX_OK : TX_FAILED;
}

// ---- JSON ----
static void stateToJson(JsonDocument &d) {
  const stdAc::state_t &s = ac.next;
  d["name"] = roomName;
  d["host"] = hostName;
  d["power"] = s.power;
  d["mode"] = toName(kModes, (int)s.mode, "cool");
  d["temp"] = s.degrees;
  d["fan"] = toName(kFans, (int)s.fanspeed, "auto");
  d["swing"] = s.swingv != stdAc::swingv_t::kOff;
  d["turbo"] = s.turbo;
  d["quiet"] = s.quiet;
  d["eco"] = s.econo;
  d["light"] = s.light;
  d["protocol"] = s.protocol == decode_type_t::UNKNOWN ? "" : typeToString(s.protocol);
  d["model"] = s.model;
  d["timer"] = active(offAt) ? (uint32_t)((offAt - millis() + 59999) / 60000) : 0;
  d["learning"] = active(learnUntil);
  d["learned"] = lastLearned;
  d["receiver"] = IR_RECV_PIN >= 0;
  d["lastSendOk"] = lastSendOk;
  d["rssi"] = WiFi.RSSI();
}

static void applyJson(JsonObjectConst o) {
  stdAc::state_t &s = ac.next;
  int v;
  if (o["power"].is<bool>()) {
    s.power = o["power"];
    if (!s.power) offAt = 0;
  }
  if (fromName(kModes, o["mode"].as<const char *>(), v)) s.mode = (stdAc::opmode_t)v;
  if (fromName(kFans, o["fan"].as<const char *>(), v)) s.fanspeed = (stdAc::fanspeed_t)v;
  if (o["temp"].is<float>()) {
    s.degrees = constrain(o["temp"].as<float>(), kMinTemp, kMaxTemp);
    s.celsius = true;
  }
  if (o["swing"].is<bool>())
    s.swingv = o["swing"].as<bool>() ? stdAc::swingv_t::kAuto : stdAc::swingv_t::kOff;
  if (o["turbo"].is<bool>()) s.turbo = o["turbo"];
  if (o["quiet"].is<bool>()) s.quiet = o["quiet"];
  if (o["eco"].is<bool>()) s.econo = o["eco"];
  if (o["light"].is<bool>()) s.light = o["light"];
  if (o["timer"].is<int>()) {
    int minutes = o["timer"];
    offAt = minutes > 0 ? (millis() + (uint32_t)minutes * 60000UL) | 1 : 0;
  }
}

// L'app chargée depuis un boîtier interroge directement les autres boîtiers.
static void sendCors() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Private-Network", "true");
}

static void reply(int code, const char *error = nullptr) {
  JsonDocument d;
  stateToJson(d);
  if (error) d["error"] = error;
  String out;
  serializeJson(d, out);
  sendCors();
  server.sendHeader("Cache-Control", "no-store");
  server.send(code, "application/json", out);
}

static void replyTx(TxResult r) {
  switch (r) {
    case TX_NO_PROTOCOL:
      return reply(409, "Choisissez d'abord la marque de votre climatisation.");
    case TX_FAILED:
      return reply(500, "Le signal infrarouge n'a pas pu être envoyé.");
    default:
      return reply(200);
  }
}

static bool parseBody(JsonDocument &d) {
  if (deserializeJson(d, server.arg("plain")) || !d.is<JsonObject>()) {
    reply(400, "Requête invalide.");
    return false;
  }
  return true;
}

// ---- Routes HTTP ----
static void serveStatic(const char *path, const char *type, const uint8_t *start,
                        const uint8_t *end, bool text) {
  size_t len = end - start - (text ? 1 : 0);  // embed_txtfiles ajoute un \0
  server.on(path, HTTP_GET, [=]() {
    server.sendHeader("Cache-Control", "no-cache");
    server.send_P(200, type, (const char *)start, len);
  });
}

static void setupRoutes() {
  serveStatic("/", "text/html; charset=utf-8", index_html_start, index_html_end, true);
  serveStatic("/index.html", "text/html; charset=utf-8", index_html_start, index_html_end, true);
  serveStatic("/app.js", "application/javascript", app_js_start, app_js_end, true);
  serveStatic("/style.css", "text/css", style_css_start, style_css_end, true);
  serveStatic("/manifest.webmanifest", "application/manifest+json", manifest_start, manifest_end, true);
  serveStatic("/sw.js", "application/javascript", sw_js_start, sw_js_end, true);
  serveStatic("/icon.svg", "image/svg+xml", icon_svg_start, icon_svg_end, true);
  serveStatic("/icon-192.png", "image/png", icon192_start, icon192_end, false);
  serveStatic("/icon-512.png", "image/png", icon512_start, icon512_end, false);
  serveStatic("/apple-touch-icon.png", "image/png", apple_icon_start, apple_icon_end, false);

  server.on("/api/state", HTTP_GET, []() { reply(200); });

  server.on("/api/state", HTTP_POST, []() {
    JsonDocument d;
    if (!parseBody(d)) return;
    // Sans marque, rien ne peut être envoyé : on refuse au lieu de mémoriser un
    // état que la clim n'a jamais reçu.
    if (ac.next.protocol == decode_type_t::UNKNOWN) return replyTx(TX_NO_PROTOCOL);
    applyJson(d.as<JsonObjectConst>());
    replyTx(transmit(false));
  });

  // Renvoie l'état complet (utile si la clim et l'app sont désynchronisées).
  server.on("/api/send", HTTP_POST, []() { replyTx(transmit(true)); });

  server.on("/api/protocols", HTTP_GET, []() {
    JsonDocument d;
    JsonArray arr = d.to<JsonArray>();
    for (int i = 1; i <= kLastDecodeType; i++) {
      decode_type_t p = (decode_type_t)i;
      if (IRac::isProtocolSupported(p)) arr.add(typeToString(p));
    }
    String out;
    serializeJson(d, out);
    sendCors();
    server.sendHeader("Cache-Control", "max-age=3600");
    server.send(200, "application/json", out);
  });

  server.on("/api/config", HTTP_POST, []() {
    JsonDocument d;
    if (!parseBody(d)) return;
    if (d["protocol"].is<const char *>()) {
      decode_type_t p = strToDecodeType(d["protocol"]);
      if (!IRac::isProtocolSupported(p)) return reply(400, "Marque non prise en charge.");
      if (p != ac.next.protocol) ac.next.model = -1;
      ac.next.protocol = p;
    }
    if (d["name"].is<const char *>()) {
      setRoomName(d["name"].as<String>());
      prefs.putString("name", roomName);
      startMdns();
    }
    if (d["model"].is<int>()) ac.next.model = d["model"];
    else if (d["model"].is<const char *>()) ac.next.model = IRac::strToModel(d["model"], -1);
    ac.markAsSent();
    saveState();
    reply(200);
  });

  server.on("/api/learn", HTTP_POST, []() {
    if (IR_RECV_PIN < 0) return reply(400, "Aucun récepteur infrarouge sur ce boîtier.");
    JsonDocument d;
    deserializeJson(d, server.arg("plain"));
    if (d["stop"] | false) {
      learnUntil = 0;
    } else {
      lastLearned = "";
      learnUntil = (millis() + kLearnDurationMs) | 1;
    }
    reply(200);
  });

  // Liste des boîtiers (celui-ci + les autres pièces). ?refresh=1 relance la recherche.
  server.on("/api/devices", HTTP_GET, []() {
    if (server.hasArg("refresh")) discoverPeers();
    JsonDocument d;
    JsonArray arr = d.to<JsonArray>();
    JsonObject me = arr.add<JsonObject>();
    me["name"] = roomName;
    me["ip"] = WiFi.localIP().toString();
    me["self"] = true;
    for (const auto &p : peers) {
      JsonObject o = arr.add<JsonObject>();
      o["name"] = p.name;
      o["ip"] = p.ip.toString();
    }
    String out;
    serializeJson(d, out);
    sendCors();
    server.sendHeader("Cache-Control", "no-store");
    server.send(200, "application/json", out);
  });

  server.onNotFound([]() {
    if (server.method() == HTTP_OPTIONS) {  // pré-requête CORS
      sendCors();
      server.sendHeader("Access-Control-Allow-Methods", "GET, POST");
      server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
      return server.send(204);
    }
    server.send(404, "text/plain", "Introuvable");
  });
}

// ---- Réception : détection de la marque + suivi de la vraie télécommande ----
static void handleIrReceive() {
#if IR_RECV_PIN >= 0
  if (!irrecv.decode(&results)) return;
  decode_type_t p = results.decode_type;
  bool learning = active(learnUntil);
  if (IRac::isProtocolSupported(p) && (learning || p == ac.next.protocol)) {
    stdAc::state_t st;
    stdAc::state_t prev = ac.next;
    if (IRAcUtils::decodeToState(&results, &st, &prev)) {
      if (!st.celsius) {
        st.degrees = roundf((st.degrees - 32) * 5 / 9);
        st.celsius = true;
      }
      st.sleep = -1;
      st.clock = -1;
      st.command = stdAc::ac_command_t::kControlCommand;
      st.iFeel = false;
      ac.next = st;
      ac.markAsSent();
      if (!ac.next.power) offAt = 0;
      if (learning) {
        lastLearned = typeToString(p);
        learnUntil = 0;
      }
      saveState();
      Serial.printf("Télécommande reçue : %s\n", typeToString(p).c_str());
    }
  }
  irrecv.resume();
#endif
}

static void handleResetButton() {
  static uint32_t pressedAt = 0;
  if (digitalRead(RESET_BUTTON_PIN) == LOW) {
    if (!pressedAt) pressedAt = millis() | 1;
    if (millis() - pressedAt > 5000) {
      Serial.println("Réinitialisation du Wi-Fi…");
      WiFiManager wm;
      wm.resetSettings();
      delay(200);
      ESP.restart();
    }
  } else {
    pressedAt = 0;
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(RESET_BUTTON_PIN, INPUT_PULLUP);
  prefs.begin("clim", false);
  loadState();
  setRoomName(prefs.getString("name", "Clim"));

  WiFi.mode(WIFI_STA);
  WiFi.setHostname(hostName.c_str());
  WiFiManager wm;
  wm.setConfigPortalTimeout(300);
  WiFiManagerParameter roomParam("room", "Nom de la pi&egrave;ce (ex. Salon, Chambre)",
                                 roomName.c_str(), 32);
  wm.addParameter(&roomParam);
  bool configSaved = false;
  wm.setSaveConfigCallback([&]() { configSaved = true; });
  // Premier démarrage : se connecter au Wi-Fi "Clim-Config" depuis le téléphone
  // pour choisir le réseau de la maison et nommer la pièce.
  if (!wm.autoConnect("Clim-Config")) ESP.restart();
  if (configSaved) {
    setRoomName(roomParam.getValue());
    prefs.putString("name", roomName);
  }
  WiFi.setAutoReconnect(true);
  Serial.printf("%s connecté : http://%s  (http://%s.local)\n", roomName.c_str(),
                WiFi.localIP().toString().c_str(), hostName.c_str());

  startMdns();
  discoverPeers();

#if IR_RECV_PIN >= 0
  irrecv.enableIRIn();
#endif
  setupRoutes();
  server.begin();
}

void loop() {
  server.handleClient();
  handleIrReceive();
  handleResetButton();

  if (offAt && !active(offAt)) {
    offAt = 0;
    ac.next.power = false;
    transmit(false);
    Serial.println("Arrêt programmé exécuté");
  }
  if (learnUntil && !active(learnUntil)) learnUntil = 0;
  if (nextDiscovery && !active(nextDiscovery)) discoverPeers();
  delay(2);
}
