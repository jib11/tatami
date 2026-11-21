# Clim — piloter une climatisation infrarouge depuis son téléphone

Votre clim n'a qu'une télécommande infrarouge. Ce projet ajoute un petit boîtier
(ESP32 + LED infrarouge) posé face à la clim. Il **imite la télécommande** et sert
une **application web installable** sur iPhone et Android, utilisable depuis le Wi-Fi de la maison.

```
Téléphone ──Wi-Fi──▶ Boîtier ESP32 ──infrarouge──▶ Climatisation
 (app « Clim »)       http://clim.local
```

**Ce que fait l'app :** marche/arrêt, température (16–30 °C), mode (auto, froid, chaud,
déshumidification, ventilation), vitesse de ventilation, oscillation, turbo, silence, éco,
écran, et arrêt programmé (30 min à 8 h).

**Marques :** plus de 80 protocoles via la bibliothèque
[IRremoteESP8266](https://github.com/crankyoldgit/IRremoteESP8266) : Daikin, Mitsubishi, Fujitsu/Atlantic,
Midea, Gree, Samsung, LG, Panasonic, Toshiba, Hitachi, Haier, TCL, Electrolux, etc.
Avec le récepteur infrarouge (conseillé), **la marque est détectée automatiquement** :
il suffit d'appuyer sur un bouton de la vraie télécommande. L'app suit aussi ensuite
les changements faits avec la télécommande d'origine.

---

## 1. Matériel (environ 10 €)

| Pièce | Exemple | Rôle |
|---|---|---|
| Carte ESP32 | « ESP32 DevKit V1 » (ESP32-WROOM-32) | Le cerveau, avec Wi-Fi |
| LED infrarouge 940 nm | TSAL6200 ou LED IR 5 mm | Émet les commandes |
| Transistor NPN | 2N2222 ou BC547 | Alimente la LED pour plus de portée |
| Résistances | 1 kΩ et 33 Ω (pour 5 V) | |
| Récepteur IR 38 kHz (conseillé) | VS1838B ou TSOP38238 | Détection de la marque + suivi de la télécommande |
| Câble USB + chargeur | | Alimentation permanente |

> Plus simple : un module « émetteur IR » tout fait pour Arduino (LED + transistor déjà soudés)
> se branche directement sur GND / 5 V / signal.

## 2. Câblage

```
ESP32 GPIO4 ──[1 kΩ]──▶ Base du transistor (milieu sur un 2N2222)
ESP32 5V (VIN) ──[33 Ω]──▶ Patte longue (+) de la LED IR
Patte courte (−) de la LED ──▶ Collecteur du transistor
Émetteur du transistor ──▶ GND

Récepteur VS1838B (face bombée vers vous) :  OUT → GPIO14   GND → GND   VCC → 3V3
```

Les broches se changent dans `platformio.ini` (`IR_SEND_PIN`, `IR_RECV_PIN`).
Sans récepteur, mettez `-DIR_RECV_PIN=-1` et choisissez la marque à la main dans l'app.

Placez la LED **face à la clim**, à vue directe (portée habituelle : 3 à 6 m avec le transistor).

## 3. Installer le programme sur l'ESP32

1. Installez [VS Code](https://code.visualstudio.com/) puis l'extension **PlatformIO IDE**
   (ou en ligne de commande : `pip install platformio`).
2. Ouvrez ce dossier dans VS Code, branchez l'ESP32 en USB.
3. Cliquez sur **→ Upload** dans la barre PlatformIO (ou `pio run -t upload`).
   L'application web est intégrée au programme : un seul envoi suffit.

## 4. Connecter le boîtier au Wi-Fi

1. Au premier démarrage, le boîtier crée un réseau Wi-Fi **« Clim-Config »**.
2. Connectez-y votre téléphone : une page s'ouvre (sinon allez sur `http://192.168.4.1`).
3. Choisissez le Wi-Fi de la maison et tapez son mot de passe. Le boîtier redémarre et s'y connecte.

Pour changer de réseau plus tard : **maintenez le bouton BOOT de l'ESP32 pendant 5 secondes.**

## 5. Installer l'app sur le téléphone

Ouvrez **http://clim.local** dans le navigateur du téléphone, connecté au même Wi-Fi.
Si l'adresse ne marche pas (certains Android), utilisez l'adresse IP du boîtier, visible
dans votre box internet ou dans le moniteur série (`pio device monitor`).

- **iPhone** (Safari) : bouton Partager → **Sur l'écran d'accueil**
- **Android** (Chrome) : menu ⋮ → **Ajouter à l'écran d'accueil**

L'icône « Clim » s'ouvre ensuite en plein écran, comme une app.

## 6. Premier réglage

1. Ouvrez **Réglages** (roue dentée).
2. **Détecter avec ma télécommande** : pointez la télécommande vers le boîtier et appuyez sur
   n'importe quel bouton. La marque s'affiche.
3. Sinon, choisissez la marque dans la liste. Si la clim ne réagit pas, essayez un autre
   protocole de la même marque (ex. Daikin, Daikin2…) ou un numéro de **modèle**.

> ⚠️ Fujitsu/Atlantic : un mauvais numéro de modèle peut bloquer la clim, qu'il faut alors
> débrancher quelques secondes. Laissez « Par défaut » sauf besoin.

---

## Bon à savoir

- **L'infrarouge fonctionne dans un seul sens.** La clim ne répond pas, donc l'app affiche
  l'état *envoyé*. Avec le récepteur, les changements faits à la télécommande sont suivis.
  En cas de doute : Réglages → **Renvoyer l'état à la clim**.
- **Uniquement sur le Wi-Fi de la maison.** Le boîtier n'est pas exposé sur Internet et n'a
  pas de mot de passe : quiconque est sur votre Wi-Fi peut piloter la clim. Pour y accéder
  à distance de façon sûre, installez un VPN comme Tailscale ou WireGuard sur votre box ;
  n'ouvrez pas de port sur Internet.
- Les réglages et le dernier état sont conservés après une coupure de courant.
- **Aperçu sans boîtier :** ouvrir `web/index.html` dans un navigateur lance un mode démo.

## Structure

```
platformio.ini   configuration de compilation (broches, bibliothèques)
src/main.cpp     programme de l'ESP32 : Wi-Fi, API, émission/réception infrarouge
web/             l'application (HTML/CSS/JS), intégrée au programme
```

### API (pour domotique ou raccourcis iOS)

| Requête | Effet |
|---|---|
| `GET /api/state` | État actuel |
| `POST /api/state` `{"power":true,"mode":"cool","temp":22,"fan":"auto","timer":60}` | Change n'importe quels champs puis envoie |
| `POST /api/send` | Renvoie tout l'état |
| `GET /api/protocols` | Marques prises en charge |
| `POST /api/config` `{"protocol":"DAIKIN","model":-1}` | Choisit la marque |
| `POST /api/learn` | Détection de la marque pendant 30 s |

Exemple de raccourci iPhone « Allume la clim » : action *Obtenir le contenu de l'URL*,
méthode POST, `http://clim.local/api/state`, corps JSON `{"power": true}`.
