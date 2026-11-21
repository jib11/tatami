'use strict';

const MIN_TEMP = 16;
const MAX_TEMP = 30;
const ARC = 414.69; // longueur de l'arc (270°) du cadran, r = 88

const svg = (d) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="${d}"/></svg>`;
const MODES = [
  { id: 'auto', label: 'Auto', ico: svg('M5 19 12 4l7 15M8 13h8') },
  { id: 'cool', label: 'Froid', ico: svg('M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M9 4l3 2 3-2M9 20l3-2 3 2') },
  { id: 'heat', label: 'Chaud', ico: svg('M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4') },
  { id: 'dry', label: 'Déshum.', ico: svg('M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z') },
  { id: 'fan', label: 'Ventil.', ico: svg('M12 12c0-3 1-7 4-7s3 4 0 6l-4 1ZM12 12c3 0 7 1 7 4s-4 3-6 0l-1-4ZM12 12c0 3-1 7-4 7s-3-4 0-6l4-1ZM12 12c-3 0-7-1-7-4s4-3 6 0l1 4Z') },
];
const FANS = [
  { id: 'auto', label: 'Auto' },
  { id: 'low', label: 'Faible' },
  { id: 'medium', label: 'Moyen' },
  { id: 'high', label: 'Fort' },
];
const TOGGLES = [
  { id: 'swing', label: 'Oscillation' },
  { id: 'turbo', label: 'Turbo' },
  { id: 'quiet', label: 'Silence' },
  { id: 'eco', label: 'Éco' },
  { id: 'light', label: 'Écran' },
];
const TIMERS = [
  { min: 0, label: 'Non' },
  { min: 30, label: '30 min' },
  { min: 60, label: '1 h' },
  { min: 120, label: '2 h' },
  { min: 240, label: '4 h' },
  { min: 480, label: '8 h' },
];
// Noms lisibles des protocoles les plus courants (bibliothèque IRremoteESP8266).
const BRANDS = {
  COOLIX: 'Midea / Electrolux / Comfee / Beko (Coolix)',
  MIDEA: 'Midea / Comfee / Pioneer',
  DAIKIN: 'Daikin', DAIKIN2: 'Daikin (2)', DAIKIN216: 'Daikin (216)',
  DAIKIN160: 'Daikin (160)', DAIKIN176: 'Daikin (176)', DAIKIN128: 'Daikin (128)',
  DAIKIN152: 'Daikin (152)', DAIKIN64: 'Daikin (64)', DAIKIN200: 'Daikin (200)', DAIKIN312: 'Daikin (312)',
  MITSUBISHI_AC: 'Mitsubishi Electric', MITSUBISHI112: 'Mitsubishi Electric (112)',
  MITSUBISHI136: 'Mitsubishi Electric (136)', MITSUBISHI_HEAVY_88: 'Mitsubishi Heavy (88)',
  MITSUBISHI_HEAVY_152: 'Mitsubishi Heavy (152)',
  FUJITSU_AC: 'Fujitsu / Atlantic', GREE: 'Gree', SAMSUNG_AC: 'Samsung', LG: 'LG', LG2: 'LG (2)',
  PANASONIC_AC: 'Panasonic', PANASONIC_AC32: 'Panasonic (32)', TOSHIBA_AC: 'Toshiba',
  HITACHI_AC: 'Hitachi', HITACHI_AC1: 'Hitachi (1)', HITACHI_AC344: 'Hitachi (344)', HITACHI_AC424: 'Hitachi (424)',
  HAIER_AC: 'Haier', HAIER_AC_YRW02: 'Haier (YRW02)', HAIER_AC176: 'Haier (176)', HAIER_AC160: 'Haier (160)',
  SHARP_AC: 'Sharp', TCL112AC: 'TCL', TCL96AC: 'TCL (96)', ELECTRA_AC: 'Electra / AEG',
  WHIRLPOOL_AC: 'Whirlpool', CARRIER_AC64: 'Carrier', KELVINATOR: 'Kelvinator', SANYO_AC: 'Sanyo',
  ARGO: 'Argo', TROTEC: 'Trotec', VESTEL_AC: 'Vestel', AIRWELL: 'Airwell', BOSCH144: 'Bosch',
  TECO: 'Teco', CORONA_AC: 'Corona', YORK: 'York', KELON: 'Kelon / Hisense', DELONGHI_AC: "De'Longhi",
  AMCOR: 'Amcor', NEOCLIMA: 'Neoclima', GOODWEATHER: 'Goodweather', ECOCLIM: 'EcoClim', RHOSS: 'Rhoss',
};

const $ = (id) => document.getElementById(id);
const el = {
  status: $('status'), statusText: $('statusText'), banner: $('banner'),
  tempValue: $('tempValue'), modeLabel: $('modeLabel'), subLabel: $('subLabel'), ringFill: $('ringFill'),
  powerBtn: $('powerBtn'), powerLabel: $('powerLabel'),
  modeSeg: $('modeSeg'), fanSeg: $('fanSeg'), toggles: $('toggles'), timerSeg: $('timerSeg'),
  settings: $('settings'), protoSelect: $('protoSelect'), modelInput: $('modelInput'),
  learnBtn: $('learnBtn'), learnStatus: $('learnStatus'), learnField: $('learnField'),
  resendBtn: $('resendBtn'), deviceInfo: $('deviceInfo'), toast: $('toast'),
};

let state = {
  power: false, mode: 'cool', temp: 24, fan: 'auto', swing: false, turbo: false,
  quiet: false, eco: false, light: true, protocol: '', model: -1, timer: 0,
  learning: false, learned: '', receiver: true, lastSendOk: true,
};
let demo = false;
let pending = {};
let sendTimer = null;
let inflight = false;
let learnPoll = null;

// ---------- API (avec mode démo si le boîtier est injoignable) ----------
async function api(path, body) {
  if (demo) return demoApi(path, body);
  const res = await fetch('api/' + path, body === undefined
    ? { cache: 'no-store' }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let data = {};
  try { data = await res.json(); } catch (_) { /* réponse vide */ }
  if (!res.ok) {
    const err = new Error(data.error || `Erreur ${res.status}`);
    err.status = res.status; err.data = data;
    throw err;
  }
  return data;
}

function demoApi(path, body) {
  if (path === 'protocols') return Object.keys(BRANDS);
  if (path === 'state' && body) {
    Object.assign(state, body);
    if (body.power === false) state.timer = 0;
  }
  if (path === 'config') Object.assign(state, body);
  if (path === 'learn') {
    state.learning = !body.stop;
    if (state.learning) setTimeout(() => { state.learning = false; state.learned = 'DAIKIN'; state.protocol = 'DAIKIN'; }, 2500);
  }
  return { ...state };
}

// ---------- Rendu ----------
function buildSeg(container, items, key, onPick) {
  container.innerHTML = '';
  for (const it of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.value = it[key];
    b.setAttribute('aria-pressed', 'false');
    b.innerHTML = (it.ico || '') + `<span>${it.label}</span>`;
    b.addEventListener('click', () => onPick(it[key]));
    container.appendChild(b);
  }
}

function press(container, value) {
  for (const b of container.children) b.setAttribute('aria-pressed', String(b.dataset.value === String(value)));
}

function fmtDuration(min) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

function render() {
  const s = state;
  const mode = MODES.find((m) => m.id === s.mode) || MODES[1];
  const noTemp = s.mode === 'fan';
  document.body.dataset.mode = mode.id;
  document.body.classList.toggle('is-off', !s.power);
  document.body.classList.toggle('no-temp', noTemp);

  el.tempValue.textContent = Number(s.temp).toFixed(Number.isInteger(+s.temp) ? 0 : 1);
  el.modeLabel.textContent = s.power ? mode.label : 'Éteinte';
  const frac = (s.temp - MIN_TEMP) / (MAX_TEMP - MIN_TEMP);
  el.ringFill.style.strokeDasharray = `${Math.max(0.01, frac * ARC)} 552.92`;
  el.subLabel.textContent = s.power && s.timer ? `Arrêt dans ${fmtDuration(s.timer)}` : '';

  el.powerLabel.textContent = s.power ? 'Éteindre' : 'Allumer';
  press(el.modeSeg, s.mode);
  press(el.fanSeg, s.fan);
  for (const b of el.toggles.children) b.setAttribute('aria-pressed', String(!!s[b.dataset.value]));
  const timerPick = s.timer ? TIMERS.reduce((a, t) => (t.min && Math.abs(t.min - s.timer) < Math.abs(a.min - s.timer) ? t : a), TIMERS[1]).min : 0;
  press(el.timerSeg, s.power ? timerPick : 0);

  el.learnField.hidden = !s.receiver;
  if (el.protoSelect.value !== s.protocol && document.activeElement !== el.protoSelect) el.protoSelect.value = s.protocol;
  if (document.activeElement !== el.modelInput) el.modelInput.value = s.model > 0 ? s.model : '';
  el.deviceInfo.textContent = demo
    ? 'Mode démo : aucun boîtier connecté.'
    : `Boîtier : ${location.host}${s.rssi ? ` · Wi-Fi ${s.rssi} dBm` : ''}`;

  if (!s.protocol && !demo) {
    showBanner('Aucune marque choisie : la clim ne recevra rien. <button type="button" data-open-settings>Configurer</button>');
  } else if (demo) {
    showBanner('Mode démo : le boîtier n\'est pas joignable, les commandes ne sont pas envoyées.');
  } else {
    showBanner('');
  }
}

function showBanner(html) {
  el.banner.hidden = !html;
  if (el.banner.innerHTML !== html) el.banner.innerHTML = html;
}

function setStatus(kind, text) {
  el.status.className = 'status ' + kind;
  el.statusText.textContent = text;
}

let toastTimer;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2800);
}

// ---------- Envoi des changements (regroupés pour n'émettre qu'un signal) ----------
function change(patch, delay = 350) {
  Object.assign(state, patch);
  Object.assign(pending, patch);
  render();
  if (navigator.vibrate) navigator.vibrate(8);
  clearTimeout(sendTimer);
  sendTimer = setTimeout(flush, delay);
}

async function flush() {
  if (inflight || !Object.keys(pending).length) return;
  const patch = pending;
  pending = {};
  inflight = true;
  try {
    const s = await api('state', patch);
    if (!Object.keys(pending).length) state = { ...state, ...s };
    setOnline();
  } catch (e) {
    handleError(e);
  } finally {
    inflight = false;
    if (Object.keys(pending).length) flush();
    render();
  }
}

function handleError(e) {
  if (e.status === 409) {
    if (e.data) state = { ...state, ...e.data };
    toast(e.message);
    openSettings();
  } else if (e.status) {
    toast(e.message);
  } else {
    setStatus('offline', 'Boîtier injoignable');
    toast('Boîtier injoignable — vérifiez le Wi-Fi.');
  }
}

function setOnline() {
  if (demo) return setStatus('demo', 'Mode démo');
  setStatus('online', state.lastSendOk === false ? 'Connecté · dernier envoi en échec' : 'Connecté');
}

async function refresh() {
  if (inflight || Object.keys(pending).length || document.hidden) return;
  try {
    const s = await api('state');
    if (!inflight && !Object.keys(pending).length) state = { ...state, ...s };
    setOnline();
    render();
  } catch (e) {
    if (!demo) setStatus('offline', 'Boîtier injoignable');
  }
}

// ---------- Réglages ----------
async function loadProtocols() {
  let list = [];
  try { list = await api('protocols'); } catch (_) { return; }
  const known = list.filter((p) => BRANDS[p]).sort((a, b) => BRANDS[a].localeCompare(BRANDS[b], 'fr'));
  const others = list.filter((p) => !BRANDS[p]).sort();
  const group = (label, items) => {
    const g = document.createElement('optgroup');
    g.label = label;
    for (const p of items) g.appendChild(new Option(BRANDS[p] ? `${BRANDS[p]} — ${p}` : p, p));
    return g;
  };
  el.protoSelect.length = 1;
  el.protoSelect.appendChild(group('Marques courantes', known));
  if (others.length) el.protoSelect.appendChild(group('Autres protocoles', others));
  el.protoSelect.value = state.protocol;
}

function openSettings() {
  if (!el.settings.open) el.settings.showModal();
}

async function saveConfig(cfg) {
  try {
    state = { ...state, ...(await api('config', cfg)) };
    render();
    toast('Réglage enregistré');
  } catch (e) { handleError(e); }
}

async function startLearning() {
  try {
    state = { ...state, ...(await api('learn', {})) };
  } catch (e) { return handleError(e); }
  el.learnBtn.disabled = true;
  el.learnStatus.textContent = 'J\'écoute… Appuyez sur un bouton de la télécommande, pointée vers le boîtier.';
  const started = Date.now();
  clearInterval(learnPoll);
  learnPoll = setInterval(async () => {
    try { state = { ...state, ...(await api('state')) }; } catch (_) { /* on réessaie */ }
    if (state.learned) {
      el.learnStatus.textContent = `✓ Reconnu : ${BRANDS[state.learned] || state.learned}. L'app suit aussi désormais votre télécommande.`;
    } else if (!state.learning || Date.now() - started > 32000) {
      el.learnStatus.textContent = 'Rien reconnu. Réessayez plus près du boîtier, ou choisissez la marque dans la liste.';
    } else {
      return;
    }
    clearInterval(learnPoll);
    el.learnBtn.disabled = false;
    render();
  }, 1000);
}

// ---------- Initialisation ----------
function bind() {
  buildSeg(el.modeSeg, MODES, 'id', (mode) => change({ mode, power: true }));
  buildSeg(el.fanSeg, FANS, 'id', (fan) => change({ fan }));
  buildSeg(el.timerSeg, TIMERS, 'min', (min) => {
    if (min && !state.power) return toast('Allumez d\'abord la clim.');
    change({ timer: Number(min) }, 0);
  });
  buildSeg(el.toggles, TOGGLES, 'id', (id) => change({ [id]: !state[id] }));

  el.powerBtn.addEventListener('click', () => change({ power: !state.power }, 0));
  const stepTemp = (d) => {
    if (state.mode === 'fan') return toast('Pas de température en mode ventilation.');
    change({ temp: Math.min(MAX_TEMP, Math.max(MIN_TEMP, Math.round(state.temp) + d)) }, 600);
  };
  $('tempUp').addEventListener('click', () => stepTemp(1));
  $('tempDown').addEventListener('click', () => stepTemp(-1));

  $('settingsBtn').addEventListener('click', openSettings);
  el.banner.addEventListener('click', (e) => { if (e.target.closest('[data-open-settings]')) openSettings(); });
  el.settings.addEventListener('click', (e) => { if (e.target === el.settings) el.settings.close(); });
  el.protoSelect.addEventListener('change', () => el.protoSelect.value && saveConfig({ protocol: el.protoSelect.value }));
  el.modelInput.addEventListener('change', () => saveConfig({ model: el.modelInput.value ? Number(el.modelInput.value) : -1 }));
  el.learnBtn.addEventListener('click', startLearning);
  el.resendBtn.addEventListener('click', async () => {
    try { state = { ...state, ...(await api('send', {})) }; toast('État renvoyé à la clim'); } catch (e) { handleError(e); }
  });

  document.addEventListener('visibilitychange', refresh);
}

async function init() {
  bind();
  render();
  try {
    state = { ...state, ...(await api('state')) };
  } catch (_) {
    demo = true; // ouvert hors du boîtier (aperçu) : on passe en démo
  }
  setOnline();
  render();
  loadProtocols();
  setInterval(refresh, 5000);
  if ('serviceWorker' in navigator && !demo) navigator.serviceWorker.register('sw.js').catch(() => {});
}

init();
