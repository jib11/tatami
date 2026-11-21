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
  status: $('status'), statusText: $('statusText'), banner: $('banner'), rooms: $('rooms'), allOffBtn: $('allOffBtn'),
  tempValue: $('tempValue'), modeLabel: $('modeLabel'), subLabel: $('subLabel'), ringFill: $('ringFill'),
  powerBtn: $('powerBtn'), powerLabel: $('powerLabel'),
  modeSeg: $('modeSeg'), fanSeg: $('fanSeg'), toggles: $('toggles'), timerSeg: $('timerSeg'),
  settings: $('settings'), nameInput: $('nameInput'), protoSelect: $('protoSelect'), modelInput: $('modelInput'),
  learnBtn: $('learnBtn'), learnStatus: $('learnStatus'), learnField: $('learnField'),
  resendBtn: $('resendBtn'), scanBtn: $('scanBtn'), deviceInfo: $('deviceInfo'), toast: $('toast'),
};

const DEFAULT_STATE = {
  name: 'Clim', power: false, mode: 'cool', temp: 24, fan: 'auto', swing: false, turbo: false,
  quiet: false, eco: false, light: true, protocol: '', model: -1, timer: 0,
  learning: false, learned: '', receiver: true, lastSendOk: true,
};

// Un « appareil » = un boîtier = une clim (une pièce).
// base '' = le boîtier qui a servi l'app ; sinon http://<ip>/
const newDevice = (name, base, self = false) => ({ name, base, self, online: null, state: { ...DEFAULT_STATE, name } });
let devices = [newDevice('Clim', '', true)];
let cur = devices[0];
let demo = false;
let pending = {};
let pendingDev = null;
let sendTimer = null;
let inflight = false;
let learnPoll = null;

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* stockage indisponible */ } },
};

// ---------- API (avec mode démo si le boîtier est injoignable) ----------
async function api(path, body, d = cur) {
  if (demo) return demoApi(path, body, d);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), path.includes('refresh') ? 12000 : 6000);
  try {
    // text/plain : pas de pré-requête CORS quand on parle à un autre boîtier.
    const res = await fetch(d.base + 'api/' + path, body === undefined
      ? { cache: 'no-store', signal: ctrl.signal }
      : { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body), signal: ctrl.signal });
    let data = {};
    try { data = await res.json(); } catch (_) { /* réponse vide */ }
    if (!res.ok) {
      const err = new Error(data.error || `Erreur ${res.status}`);
      err.status = res.status; err.data = data;
      throw err;
    }
    d.online = true;
    return data;
  } catch (e) {
    if (!e.status) d.online = false;
    throw e;
  } finally {
    clearTimeout(t);
  }
}

function demoApi(path, body, d) {
  const s = d.state;
  d.online = true;
  if (path.startsWith('devices')) return [
    { name: 'Salon', ip: '', self: true }, { name: 'Chambre', ip: '192.168.1.42' }, { name: 'Bureau', ip: '192.168.1.43' },
  ];
  if (path === 'protocols') return Object.keys(BRANDS);
  if (path === 'state' && body) {
    Object.assign(s, body);
    if (body.power === false) s.timer = 0;
  }
  if (path === 'config') Object.assign(s, body);
  if (path === 'learn') {
    s.learning = !body.stop;
    if (s.learning) setTimeout(() => { s.learning = false; s.learned = 'DAIKIN'; s.protocol = 'DAIKIN'; }, 2500);
  }
  return { ...s };
}

function merge(d, data) {
  d.state = { ...d.state, ...data };
  if (data.name) d.name = data.name;
}
const hasPendingFor = (d) => pendingDev === d && Object.keys(pending).length > 0;

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

const escapeHtml = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function renderRooms() {
  el.rooms.hidden = el.allOffBtn.hidden = devices.length < 2;
  if (el.rooms.hidden) return;
  el.allOffBtn.disabled = !devices.some((d) => d.state.power && d.online !== false);
  el.rooms.innerHTML = devices.map((d, i) => {
    const dot = d.online === false ? 'offline' : d.state.power ? 'on' : 'off';
    const label = d.online === false ? 'injoignable' : d.state.power ? `allumée, ${d.state.temp} °C` : 'éteinte';
    return `<button type="button" class="room" data-i="${i}" aria-pressed="${d === cur}" aria-label="${escapeHtml(d.name)} : ${label}">
      <span class="room-dot ${dot}"></span><span class="room-name">${escapeHtml(d.name)}</span>
      ${d.state.power && d.online !== false ? `<span class="room-temp">${Math.round(d.state.temp)}°</span>` : ''}</button>`;
  }).join('');
}

function render() {
  const s = cur.state;
  const mode = MODES.find((m) => m.id === s.mode) || MODES[1];
  document.body.dataset.mode = mode.id;
  document.body.classList.toggle('is-off', !s.power);
  document.body.classList.toggle('no-temp', s.mode === 'fan');

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
  if (document.activeElement !== el.nameInput) el.nameInput.value = cur.name;
  if (el.protoSelect.value !== s.protocol && document.activeElement !== el.protoSelect) el.protoSelect.value = s.protocol;
  if (document.activeElement !== el.modelInput) el.modelInput.value = s.model > 0 ? s.model : '';
  el.deviceInfo.textContent = demo
    ? 'Mode démo : aucun boîtier connecté.'
    : `Boîtier « ${cur.name} » : ${s.host ? s.host + '.local · ' : ''}${cur.base ? cur.base.replace(/^http:\/\/|\/$/g, '') : location.host}${s.rssi ? ` · Wi-Fi ${s.rssi} dBm` : ''}`;

  if (demo) {
    showBanner('Mode démo : aucun boîtier joignable, les commandes ne sont pas envoyées.');
  } else if (cur.online !== false && !s.protocol) {
    showBanner(`Aucune marque choisie pour « ${escapeHtml(cur.name)} » : la clim ne recevra rien. <button type="button" data-open-settings>Configurer</button>`);
  } else {
    showBanner('');
  }
  renderRooms();
  renderStatus();
}

function showBanner(html) {
  el.banner.hidden = !html;
  if (el.banner.innerHTML !== html) el.banner.innerHTML = html;
}

function renderStatus() {
  if (demo) return setStatus('demo', 'Mode démo');
  if (cur.online === false) return setStatus('offline', 'Boîtier injoignable');
  if (cur.online === null) return setStatus('', 'Connexion…');
  setStatus('online', cur.state.lastSendOk === false ? 'Connecté · dernier envoi en échec' : 'Connecté');
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
  if (pendingDev && pendingDev !== cur) flushNow();
  pendingDev = cur;
  Object.assign(cur.state, patch);
  Object.assign(pending, patch);
  render();
  if (navigator.vibrate) navigator.vibrate(8);
  clearTimeout(sendTimer);
  sendTimer = setTimeout(flush, delay);
}

function flushNow() {
  clearTimeout(sendTimer);
  return flush();
}

async function flush() {
  if (inflight || !Object.keys(pending).length) return;
  const d = pendingDev;
  const patch = pending;
  pending = {};
  inflight = true;
  try {
    const s = await api('state', patch, d);
    if (!hasPendingFor(d)) merge(d, s);
  } catch (e) {
    handleError(e, d);
  } finally {
    inflight = false;
    if (Object.keys(pending).length) flush();
    render();
  }
}

function handleError(e, d = cur) {
  if (e.status === 409) {
    if (e.data) merge(d, e.data);
    toast(devices.length > 1 ? `${d.name} : ${e.message}` : e.message);
    if (d === cur) openSettings();
  } else if (e.status) {
    toast(e.message);
  } else {
    toast(`${devices.length > 1 ? d.name + ' : boîtier' : 'Boîtier'} injoignable — vérifiez qu'il est branché.`);
  }
}

async function refreshDevice(d) {
  if (hasPendingFor(d) || (inflight && pendingDev === d)) return;
  try {
    const s = await api('state', undefined, d);
    if (!hasPendingFor(d)) merge(d, s);
  } catch (_) { /* online = false, affiché sur la pastille */ }
}

async function refreshAll() {
  if (document.hidden) return;
  await Promise.all(devices.map(refreshDevice));
  render();
}

// ---------- Pièces ----------
async function loadDevices(rescan = false) {
  let list;
  try {
    list = await api(rescan ? 'devices?refresh=1' : 'devices', undefined, devices.find((d) => d.self));
  } catch (_) { return false; }
  const byBase = new Map(devices.map((d) => [d.base, d]));
  devices = list.map((x) => {
    const base = x.self ? '' : `http://${x.ip}/`;
    const d = byBase.get(base) || newDevice(x.name, base, !!x.self);
    d.name = x.name;
    return d;
  });
  // Ordre stable : alphabétique, comme les étiquettes de la maison.
  devices.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const saved = store.get('clim.room');
  cur = devices.find((d) => d.name === saved) || devices.find((d) => d.self) || devices[0];
  return true;
}

async function selectRoom(i) {
  const d = devices[i];
  if (!d || d === cur) return;
  await flushNow();
  cur = d;
  store.set('clim.room', d.name);
  clearInterval(learnPoll);
  el.learnBtn.disabled = false;
  el.learnStatus.textContent = '';
  render();
  refreshDevice(d).then(render);
}

async function allOff() {
  await flushNow();
  const on = devices.filter((d) => d.state.power && d.online !== false);
  const results = await Promise.allSettled(on.map((d) => api('state', { power: false }, d).then((s) => merge(d, s))));
  const failed = results.filter((r) => r.status === 'rejected').length;
  toast(failed ? `${on.length - failed} clim(s) éteinte(s), ${failed} en échec` : `${on.length} clim${on.length > 1 ? 's' : ''} éteinte${on.length > 1 ? 's' : ''}`);
  render();
}

// ---------- Réglages ----------
async function loadProtocols() {
  let list = [];
  try { list = await api('protocols', undefined, devices.find((d) => d.self) || cur); } catch (_) { return; }
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
  el.protoSelect.value = cur.state.protocol;
}

function openSettings() {
  if (!el.settings.open) el.settings.showModal();
}

async function saveConfig(cfg) {
  const d = cur;
  try {
    merge(d, await api('config', cfg, d));
    if (cfg.name) {
      store.set('clim.room', d.name);
      devices.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    }
    render();
    toast('Réglage enregistré');
  } catch (e) { handleError(e, d); }
}

async function startLearning() {
  const d = cur;
  try {
    merge(d, await api('learn', {}, d));
  } catch (e) { return handleError(e, d); }
  el.learnBtn.disabled = true;
  el.learnStatus.textContent = 'J\'écoute… Appuyez sur un bouton de la télécommande, pointée vers le boîtier.';
  const started = Date.now();
  clearInterval(learnPoll);
  learnPoll = setInterval(async () => {
    try { merge(d, await api('state', undefined, d)); } catch (_) { /* on réessaie */ }
    const s = d.state;
    if (s.learned) {
      el.learnStatus.textContent = `✓ Reconnu : ${BRANDS[s.learned] || s.learned}. L'app suit aussi désormais votre télécommande.`;
    } else if (!s.learning || Date.now() - started > 32000) {
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
    if (min && !cur.state.power) return toast('Allumez d\'abord la clim.');
    change({ timer: Number(min) }, 0);
  });
  buildSeg(el.toggles, TOGGLES, 'id', (id) => change({ [id]: !cur.state[id] }));

  el.powerBtn.addEventListener('click', () => change({ power: !cur.state.power }, 0));
  const stepTemp = (delta) => {
    if (cur.state.mode === 'fan') return toast('Pas de température en mode ventilation.');
    change({ temp: Math.min(MAX_TEMP, Math.max(MIN_TEMP, Math.round(cur.state.temp) + delta)) }, 600);
  };
  $('tempUp').addEventListener('click', () => stepTemp(1));
  $('tempDown').addEventListener('click', () => stepTemp(-1));

  el.rooms.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) selectRoom(Number(b.dataset.i));
  });
  el.allOffBtn.addEventListener('click', allOff);

  $('settingsBtn').addEventListener('click', openSettings);
  el.banner.addEventListener('click', (e) => { if (e.target.closest('[data-open-settings]')) openSettings(); });
  el.settings.addEventListener('click', (e) => { if (e.target === el.settings) el.settings.close(); });
  el.nameInput.addEventListener('change', () => el.nameInput.value.trim() && saveConfig({ name: el.nameInput.value.trim() }));
  el.protoSelect.addEventListener('change', () => el.protoSelect.value && saveConfig({ protocol: el.protoSelect.value }));
  el.modelInput.addEventListener('change', () => saveConfig({ model: el.modelInput.value ? Number(el.modelInput.value) : -1 }));
  el.learnBtn.addEventListener('click', startLearning);
  el.resendBtn.addEventListener('click', async () => {
    const d = cur;
    try { merge(d, await api('send', {}, d)); toast('État renvoyé à la clim'); } catch (e) { handleError(e, d); }
  });
  el.scanBtn.addEventListener('click', async () => {
    el.scanBtn.disabled = true;
    el.scanBtn.textContent = 'Recherche…';
    const before = devices.length;
    if (await loadDevices(true)) await refreshAll();
    el.scanBtn.disabled = false;
    el.scanBtn.textContent = 'Rechercher les autres boîtiers';
    const n = devices.length - 1;
    toast(devices.length > before ? `${devices.length - before} nouveau(x) boîtier(s) trouvé(s)` : n ? `${n} autre(s) boîtier(s) connu(s)` : 'Aucun autre boîtier trouvé');
    render();
  });

  document.addEventListener('visibilitychange', refreshAll);
}

async function init() {
  bind();
  render();
  try {
    merge(cur, await api('state'));
  } catch (_) {
    demo = true; // ouvert hors du boîtier (aperçu) : on passe en démo
  }
  if (demo) {
    await loadDevices();
    const [a, b] = devices.filter((d) => !d.self);
    if (a) Object.assign(a.state, { power: true, mode: 'cool', temp: 22, protocol: 'DAIKIN' });
    if (b) Object.assign(b.state, { protocol: 'GREE' });
  } else {
    await loadDevices();
    await refreshAll();
  }
  render();
  loadProtocols();
  setInterval(refreshAll, 5000);
  if ('serviceWorker' in navigator && !demo) navigator.serviceWorker.register('sw.js').catch(() => {});
}

init();
