const chat = document.getElementById('chat');
const grip = document.getElementById('grip');

let settings = null;
const tr = (key, vars) => i18n.t(settings ? settings.language : 'es', key, vars);

// ---------- Colores ----------

// Colores para usuarios que no han elegido ninguno en Twitch.
const FALLBACK_COLORS = ['#FF4A80', '#FF7070', '#FA8E4B', '#FEE440', '#5FFF77', '#00F5D4', '#00BBF9', '#4371FB', '#9B5DE5', '#F670DD'];
function colorFor(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) | 0;
  return FALLBACK_COLORS[Math.abs(h) % FALLBACK_COLORS.length];
}

// Muchos eligen colores muy oscuros (azul marino, negro...) que no se leen sobre el juego:
// se aclaran mezclándolos con blanco hasta que tengan suficiente brillo.
const readableCache = new Map();
function readable(hex) {
  if (readableCache.has(hex)) return readableCache.get(hex);
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  const lum = () => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  for (let i = 0; i < 6 && lum() < 110; i++) {
    r += (255 - r) * 0.25;
    g += (255 - g) * 0.25;
    b += (255 - b) * 0.25;
  }
  const out = `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
  readableCache.set(hex, out);
  return out;
}

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// ---------- Aspecto ----------

function applySettings(s) {
  settings = s;
  const root = document.documentElement.style;
  root.setProperty('--fs', `${s.fontSize}px`);
  root.setProperty('--ff', `"${s.fontFamily}"`);
  root.setProperty('--fw', s.bold ? '600' : '400');
  root.setProperty('--color', s.textColor);
  root.setProperty('--bg', hexToRgba(s.bgColor, s.bgOpacity / 100));
  root.setProperty('--shadow', s.outline
    ? '0 0 2px #000, 1px 1px 1px #000, -1px -1px 1px #000, 1px -1px 1px #000, -1px 1px 1px #000'
    : 'none');
  root.setProperty('--opacity', String(s.opacity / 100));
  document.documentElement.lang = s.language;
  document.body.classList.toggle('header', s.showHeader);
  document.getElementById('hint').textContent = tr('editHint');
  trim();

  if (s.channel !== joined) connect(s.channel);
}

// ---------- Conexión al chat de Twitch (anónima, solo lectura) ----------

let ws = null;
let joined = null;
let reconnectTimer = null;
let notFoundTimer = null;
let retries = 0;
let lastData = 0;

function connect(channel) {
  clearTimeout(reconnectTimer);
  clearTimeout(notFoundTimer);
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
  if (channel !== joined) {
    channelEmotes = new Map();
    emotesRoomId = null;
    retries = 0;
  }
  joined = channel;
  document.getElementById('barChannel').textContent = channel ? `#${channel}` : '';
  if (!channel) {
    system(tr('enterChannel'));
    return;
  }
  if (retries === 0) system(tr('connecting', { channel }));

  const sock = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
  let inRoom = false;
  ws = sock;
  sock.onopen = () => {
    lastData = Date.now();
    sock.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
    sock.send('PASS SCHMOOPIIE');
    sock.send(`NICK justinfan${Math.floor(10000 + Math.random() * 80000)}`);
    sock.send(`JOIN #${channel}`);
    // Twitch no da error si el canal no existe; simplemente nunca manda ROOMSTATE.
    notFoundTimer = setTimeout(() => system(tr('notFound', { channel })), 6000);
  };
  sock.onmessage = (e) => {
    lastData = Date.now();
    for (const line of e.data.split('\r\n')) {
      if (!line) continue;
      const m = parse(line);
      if (m.command === 'ROOMSTATE' && !inRoom) {
        inRoom = true;
        onJoined(m.tags['room-id']);
      } else {
        handle(m, sock);
      }
    }
  };
  // Reintentos cada vez más espaciados (2, 4, 8… hasta 30 s) para no saturar si no hay internet.
  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null;
    if (retries === 0) system(tr('connectionLost'));
    const delay = Math.min(30000, 2000 * 2 ** retries);
    retries++;
    reconnectTimer = setTimeout(() => connect(joined), delay);
  };
}

function onJoined(roomId) {
  clearTimeout(notFoundTimer);
  retries = 0;
  system(tr('connected', { channel: joined }));
  if (roomId && roomId !== emotesRoomId) loadChannelEmotes(roomId);
}

// Twitch manda un PING cada ~5 min. Si pasa mucho sin recibir nada (p. ej. tras suspender
// el PC o cambiar de wifi), la conexión está muerta aunque no lo parezca: se rehace.
setInterval(() => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const idle = Date.now() - lastData;
  if (idle > 6 * 60 * 1000) ws.close();
  else if (idle > 4 * 60 * 1000) ws.send('PING :kylen');
}, 30000);

function reconnectNow() {
  if (!joined) return;
  retries = 0;
  connect(joined);
}

// Los valores de las etiquetas de Twitch vienen "escapados" (\s = espacio, etc.).
function unescapeTag(value) {
  return value.replace(/\\(.)/g, (_, c) => ({ s: ' ', ':': ';', r: '\r', n: '\n', '\\': '\\' }[c] || c));
}

function parse(line) {
  const tags = {};
  if (line[0] === '@') {
    const i = line.indexOf(' ');
    for (const kv of line.slice(1, i).split(';')) {
      const j = kv.indexOf('=');
      tags[kv.slice(0, j)] = kv.slice(j + 1);
    }
    line = line.slice(i + 1);
  }
  let prefix = '';
  if (line[0] === ':') {
    const i = line.indexOf(' ');
    prefix = line.slice(1, i);
    line = line.slice(i + 1);
  }
  let trailing = null;
  const t = line.indexOf(' :');
  if (t !== -1) {
    trailing = line.slice(t + 2);
    line = line.slice(0, t);
  }
  const [command, ...params] = line.split(' ');
  return { tags, prefix, command, params, trailing };
}

function messageFrom(m) {
  const user = m.tags.login || m.prefix.split('!')[0];
  return {
    id: m.tags.id,
    user,
    name: m.tags['display-name'] || user,
    color: m.tags.color,
    emotes: m.tags.emotes,
    text: m.trailing || '',
  };
}

function handle(m, sock) {
  switch (m.command) {
    case 'PING':
      sock.send(`PONG :${m.trailing || 'tmi.twitch.tv'}`);
      break;
    case 'PRIVMSG':
      if (!testMode) addMessage(messageFrom(m));
      break;
    case 'USERNOTICE': // subs, regalos, raids, anuncios...
      if (!testMode) addNotice(unescapeTag(m.tags['system-msg'] || ''), m.trailing ? messageFrom(m) : null);
      break;
    case 'CLEARCHAT': // un moderador ha borrado el chat o baneado a alguien
      removeWhere(m.trailing ? (el) => el.dataset.user === m.trailing.toLowerCase() : () => true);
      break;
    case 'CLEARMSG':
      removeWhere((el) => el.dataset.id === m.tags['target-msg-id']);
      break;
    case 'NOTICE':
      if (m.trailing) system(m.trailing);
      break;
    case 'RECONNECT': // Twitch avisa de que va a reiniciar el servidor
      retries = 0;
      sock.close();
      break;
  }
}

// ---------- Emotes de 7TV, BTTV y FFZ ----------
// Se descargan una vez por canal y se guardan en memoria; buscar una palabra es instantáneo.

let globalEmotes = new Map();
let channelEmotes = new Map();
let emotesRoomId = null;

const getJSON = (url) => fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);

function add7tv(map, list) {
  for (const e of list || []) {
    const host = e.data && e.data.host && e.data.host.url;
    if (!host) continue;
    const zeroWidth = (e.flags & 1) === 1 || ((e.data.flags || 0) & 256) === 256;
    map.set(e.name, {
      url: `https:${host}/2x.webp`,
      still: e.data.animated ? `https:${host}/2x_static.webp` : null,
      zeroWidth,
    });
  }
}
function addBttv(map, list) {
  for (const e of list || []) {
    const base = `https://cdn.betterttv.net/emote/${e.id}`;
    map.set(e.code, { url: `${base}/2x.webp`, still: e.animated ? `${base}/static/2x.webp` : null });
  }
}
function addFfz(map, list) {
  for (const e of list || []) {
    const url = e.images && (e.images['2x'] || e.images['1x']);
    if (url) map.set(e.code, { url });
  }
}

async function loadGlobalEmotes() {
  const [stv, bttv, ffz] = await Promise.all([
    getJSON('https://7tv.io/v3/emote-sets/global'),
    getJSON('https://api.betterttv.net/3/cached/emotes/global'),
    getJSON('https://api.betterttv.net/3/cached/frankerfacez/emotes/global'),
  ]);
  const map = new Map();
  addFfz(map, ffz);
  addBttv(map, bttv);
  add7tv(map, stv && stv.emotes);
  globalEmotes = map;
}

async function loadChannelEmotes(roomId) {
  emotesRoomId = roomId;
  const [stv, bttv, ffz] = await Promise.all([
    getJSON(`https://7tv.io/v3/users/twitch/${roomId}`),
    getJSON(`https://api.betterttv.net/3/cached/users/twitch/${roomId}`),
    getJSON(`https://api.betterttv.net/3/cached/frankerfacez/users/twitch/${roomId}`),
  ]);
  if (emotesRoomId !== roomId) return; // se cambió de canal mientras cargaba
  const map = new Map();
  addFfz(map, ffz);
  addBttv(map, bttv && [...(bttv.channelEmotes || []), ...(bttv.sharedEmotes || [])]);
  add7tv(map, stv && stv.emote_set && stv.emote_set.emotes);
  channelEmotes = map;
}

const findEmote = (word) => channelEmotes.get(word) || globalEmotes.get(word);

// ---------- Mensajes en pantalla ----------

// Bots habituales de los canales; se ocultan (junto a los comandos "!algo") si el usuario lo pide.
const BOTS = new Set(['nightbot', 'streamelements', 'streamlabs', 'moobot', 'fossabot', 'wizebot', 'soundalerts', 'sery_bot', 'botrixoficial', 'kofistreambot', 'pokemoncommunitygame']);
const isBotMessage = ({ user, text }) => BOTS.has(user) || text.startsWith('!');

function addMessage(msg) {
  if (settings.hideBots && isBotMessage(msg)) return;
  const el = document.createElement('div');
  el.className = 'msg';
  fillMessage(el, msg);
  push(el);
}

// Aviso destacado: "X se ha suscrito", "Y está haciendo raid con 50 espectadores"...
function addNotice(systemText, msg) {
  if (!systemText && !msg) return;
  const el = document.createElement('div');
  el.className = 'msg notice';
  if (systemText) {
    const title = document.createElement('div');
    title.className = 'notice-title';
    title.textContent = systemText;
    el.append(title);
  }
  if (msg) {
    const line = document.createElement('div');
    fillMessage(line, msg);
    el.dataset.id = line.dataset.id;
    el.dataset.user = line.dataset.user;
    el.append(line);
  }
  push(el);
}

function fillMessage(el, { id, user, name, color, emotes, text }) {
  let action = false;
  const me = text.match(/^\x01ACTION (.*)\x01$/);
  if (me) {
    text = me[1];
    action = true;
  }
  if (action) el.classList.add('action');
  el.dataset.id = id || '';
  el.dataset.user = user || '';

  const nameEl = document.createElement('span');
  nameEl.className = 'name';
  nameEl.textContent = name;
  if (settings.userColors) nameEl.style.color = readable(color || colorFor(name));

  const textEl = document.createElement('span');
  textEl.className = 'text';
  if (action && settings.userColors) textEl.style.color = nameEl.style.color;
  renderText(textEl, text, emotes);

  el.append(nameEl, action ? ' ' : ': ', textEl);
}

// Sustituye los trozos de texto que Twitch marca como emotes por su imagen.
function renderText(parent, text, emotes) {
  const chars = Array.from(text);
  const ranges = [];
  if (emotes) {
    for (const part of emotes.split('/')) {
      const [emoteId, positions] = part.split(':');
      if (!positions) continue;
      for (const r of positions.split(',')) {
        const [a, b] = r.split('-').map(Number);
        ranges.push({ a, b, emoteId });
      }
    }
  }
  ranges.sort((x, y) => x.a - y.a);

  let i = 0;
  for (const r of ranges) {
    if (r.a < i) continue; // rango repetido o solapado
    if (r.a > i) appendWords(parent, chars.slice(i, r.a).join(''));
    const base = `https://static-cdn.jtvnw.net/emoticons/v2/${r.emoteId}`;
    const emote = { url: `${base}/default/dark/2.0`, still: `${base}/static/dark/2.0` };
    parent.append(emoteImg(emote, chars.slice(r.a, r.b + 1).join('')));
    i = r.b + 1;
  }
  if (i < chars.length) appendWords(parent, chars.slice(i).join(''));
}

// Busca palabra a palabra emotes de 7TV, BTTV y FFZ.
function appendWords(parent, str) {
  let buf = '';
  for (const word of str.split(/(\s+)/)) {
    const emote = word && findEmote(word);
    if (!emote) {
      buf += word;
      continue;
    }
    // Los emotes "zero-width" de 7TV se dibujan encima del emote anterior.
    if (emote.zeroWidth && !buf.trim() && isEmoteNode(parent.lastChild)) {
      stackOn(parent.lastChild, emoteImg(emote, word));
      buf = '';
      continue;
    }
    if (buf) parent.append(buf);
    buf = '';
    parent.append(emoteImg(emote, word));
  }
  if (buf) parent.append(buf);
}

// Los emotes animados gastan CPU sin parar; por defecto se usa su versión quieta.
function emoteImg(emote, name) {
  const img = document.createElement('img');
  img.className = 'emote';
  img.decoding = 'async';
  img.alt = img.title = name;
  img.onerror = () => img.replaceWith(name); // si no carga, se ve el texto en vez de un icono roto
  img.src = settings.animatedEmotes || !emote.still ? emote.url : emote.still;
  return img;
}

function isEmoteNode(node) {
  return node && node.nodeType === 1 && (node.classList.contains('emote') || node.classList.contains('stack'));
}

function stackOn(node, img) {
  if (node.classList.contains('stack')) {
    node.append(img);
    return;
  }
  const stack = document.createElement('span');
  stack.className = 'stack';
  node.replaceWith(stack);
  stack.append(node, img);
}

// En chats muy rápidos no pintamos cada mensaje al llegar: los juntamos y
// actualizamos la pantalla como mucho ~6 veces por segundo, y solo los que caben.
const FLUSH_MS = 150;
let pending = [];
let flushTimer = null;

function push(el) {
  pending.push(el);
  if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS);
}

function flush() {
  flushTimer = null;
  const max = settings ? settings.maxMessages : 30;
  const batch = pending.slice(-max);
  pending = [];
  const frag = document.createDocumentFragment();
  batch.forEach((el) => frag.append(el));
  chat.append(frag);
  trim();
  if (settings && settings.fadeAfter > 0) {
    setTimeout(() => {
      batch.forEach((el) => el.classList.add('fade'));
      setTimeout(() => batch.forEach((el) => el.remove()), 700);
    }, settings.fadeAfter * 1000);
  }
}

function trim() {
  const max = settings ? settings.maxMessages : 30;
  while (chat.children.length > max) chat.firstChild.remove();
}

// Borra mensajes ya pintados y también los que están esperando a pintarse.
function removeWhere(fn) {
  const matches = (el) => !el.classList.contains('system') && fn(el);
  pending = pending.filter((el) => !matches(el));
  for (const el of [...chat.children]) if (matches(el)) el.remove();
}

function system(text) {
  if (testMode) return; // en modo prueba solo se ven los ejemplos
  const el = document.createElement('div');
  el.className = 'msg system';
  el.textContent = text;
  push(el);
}

// ---------- Modo prueba ----------
// Llena el chat con mensajes de ejemplo que siguen llegando solos, para poder
// ajustar el aspecto viendo cómo quedará. Mientras está activo se ignora el chat real.

// Los ejemplos están en i18n.js, en el idioma elegido.
const samples = () => i18n.SAMPLES[settings.language] || i18n.SAMPLES.es;
// Emotes oficiales de Twitch que aparecen en los ejemplos (el resto los pone 7TV/BTTV).
const TWITCH_TEST_EMOTES = { Kappa: 25, LUL: 425618, PogChamp: 305954156 };

let testMode = false;
let testTimer = null;
let sampleIndex = 0;

function sampleMessage([name, color, text]) {
  const byId = {};
  let pos = 0;
  for (const word of text.split(' ')) {
    const len = Array.from(word).length;
    const id = TWITCH_TEST_EMOTES[word];
    if (id) (byId[id] = byId[id] || []).push(`${pos}-${pos + len - 1}`);
    pos += len + 1;
  }
  const emotes = Object.entries(byId).map(([id, ranges]) => `${id}:${ranges.join(',')}`).join('/');
  return { id: '', user: name.toLowerCase(), name, color, emotes, text };
}

function testMessage() {
  const list = samples();
  const sample = list[sampleIndex++ % list.length];
  if (Array.isArray(sample)) addMessage(sampleMessage(sample));
  else addNotice(sample.notice, sample.msg ? sampleMessage(sample.msg) : null);
}

function clearChat() {
  pending = [];
  chat.replaceChildren();
}

function setTestMode(on) {
  if (on === testMode) return;
  testMode = on;
  clearInterval(testTimer);
  clearChat();
  if (on) {
    const first = Math.min(settings.maxMessages, samples().length);
    for (let i = 0; i < first; i++) testMessage();
    testTimer = setInterval(testMessage, 1500);
  } else {
    system(joined ? tr('chatOf', { channel: joined }) : tr('enterChannel'));
  }
}

// ---------- Cambiar tamaño con la esquina ----------

grip.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  grip.setPointerCapture(e.pointerId);
  const startX = e.screenX;
  const startY = e.screenY;
  api.resizeStart();
  const move = (ev) => api.resizeMove(ev.screenX - startX, ev.screenY - startY);
  const up = () => {
    grip.removeEventListener('pointermove', move);
    grip.removeEventListener('pointerup', up);
    api.resizeEnd();
  };
  grip.addEventListener('pointermove', move);
  grip.addEventListener('pointerup', up);
});

// ---------- Inicio ----------

api.onSettings(applySettings);
api.onEditMode((on) => document.body.classList.toggle('edit', on));
api.onTestMode(setTestMode);
api.onReconnect(reconnectNow);
api.getSettings().then(applySettings);
loadGlobalEmotes();
