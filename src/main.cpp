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

#ifndef IR_SEND_PIN
#define IR_SEND_PIN 4
#endif
#ifndef IR_RECV_PIN
#define IR_RECV_PIN 14
#endif
#ifndef HOSTNAME
#define HOSTNAME "clim"
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

static void reply(int code, const char *error = nullptr) {
  JsonDocument d;
  stateToJson(d);
  if (error) d["error"] = error;
  String out;
  serializeJson(d, out);
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

  server.onNotFound([]() { server.send(404, "text/plain", "Introuvable"); });
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

  WiFi.mode(WIFI_STA);
  WiFi.setHostname(HOSTNAME);
  WiFiManager wm;
  wm.setConfigPortalTimeout(300);
  // Premier démarrage : se connecter au Wi-Fi "Clim-Config" depuis le téléphone
  // pour choisir le réseau de la maison.
  if (!wm.autoConnect("Clim-Config")) ESP.restart();
  WiFi.setAutoReconnect(true);
  Serial.printf("Connecté : http://%s  (http://%s.local)\n",
                WiFi.localIP().toString().c_str(), HOSTNAME);

  if (MDNS.begin(HOSTNAME)) MDNS.addService("http", "tcp", 80);

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
  delay(2);
}
