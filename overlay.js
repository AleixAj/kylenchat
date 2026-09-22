const chat = document.getElementById('chat');
const grip = document.getElementById('grip');

let settings = null;
let ws = null;
let joined = null;
let reconnectTimer = null;
let notFoundTimer = null;

// Colores para usuarios que no han elegido ninguno en Twitch.
const FALLBACK_COLORS = ['#FF4A80', '#FF7070', '#FA8E4B', '#FEE440', '#5FFF77', '#00F5D4', '#00BBF9', '#4371FB', '#9B5DE5', '#F670DD'];
function colorFor(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) | 0;
  return FALLBACK_COLORS[Math.abs(h) % FALLBACK_COLORS.length];
}

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function normalizeChannel(value) {
  return (value || '').trim()
    .replace(/^https?:\/\/(www\.)?twitch\.tv\//i, '')
    .replace(/^#/, '')
    .split(/[/?]/)[0]
    .toLowerCase();
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
  trim();

  const channel = normalizeChannel(s.channel);
  if (channel !== joined) connect(channel);
}

// ---------- Conexión al chat de Twitch (anónima, solo lectura) ----------

function connect(channel) {
  clearTimeout(reconnectTimer);
  clearTimeout(notFoundTimer);
  channelEmotes = new Map();
  emotesRoomId = null;
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
  joined = channel;
  if (!channel) {
    system('Escribe el nombre de un canal en Ajustes.');
    return;
  }
  system(`Conectando a #${channel}…`);

  const sock = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
  ws = sock;
  sock.onopen = () => {
    sock.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
    sock.send('PASS SCHMOOPIIE');
    sock.send(`NICK justinfan${Math.floor(10000 + Math.random() * 80000)}`);
    sock.send(`JOIN #${channel}`);
    // Twitch no da error si el canal no existe; simplemente nunca manda ROOMSTATE.
    notFoundTimer = setTimeout(() => system(`No se encuentra el canal "${channel}". ¿Está bien escrito?`), 6000);
  };
  sock.onmessage = (e) => e.data.split('\r\n').forEach((line) => line && handle(line, sock));
  sock.onclose = () => {
    if (ws !== sock) return;
    system('Conexión perdida, reintentando…');
    reconnectTimer = setTimeout(() => connect(joined), 3000);
  };
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

function handle(line, sock) {
  const m = parse(line);
  const user = m.prefix.split('!')[0];
  switch (m.command) {
    case 'PING':
      sock.send(`PONG :${m.trailing || 'tmi.twitch.tv'}`);
      break;
    case 'ROOMSTATE': // llega al entrar en un canal que existe
      if (m.tags['room-id'] && m.tags['room-id'] !== emotesRoomId) {
        clearTimeout(notFoundTimer);
        system(`Conectado al chat de #${joined}`);
        loadChannelEmotes(m.tags['room-id']);
      }
      break;
    case 'PRIVMSG':
      addMessage({
        id: m.tags.id,
        user,
        name: m.tags['display-name'] || user,
        color: m.tags.color,
        emotes: m.tags.emotes,
        text: m.trailing || '',
      });
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
    case 'RECONNECT':
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

function addMessage({ id, user, name, color, emotes, text }) {
  let action = false;
  const me = text.match(/^\x01ACTION (.*)\x01$/);
  if (me) {
    text = me[1];
    action = true;
  }

  const el = document.createElement('div');
  el.className = action ? 'msg action' : 'msg';
  el.dataset.id = id || '';
  el.dataset.user = user || '';

  const nameEl = document.createElement('span');
  nameEl.className = 'name';
  nameEl.textContent = name;
  if (settings.userColors) nameEl.style.color = color || colorFor(name);

  const textEl = document.createElement('span');
  textEl.className = 'text';
  if (action && settings.userColors) textEl.style.color = nameEl.style.color;
  renderText(textEl, text, emotes);

  el.append(nameEl, action ? ' ' : ': ', textEl);
  push(el);
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
  img.src = settings.animatedEmotes || !emote.still ? emote.url : emote.still;
  img.alt = img.title = name;
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
    const ms = settings.fadeAfter * 1000;
    setTimeout(() => {
      batch.forEach((el) => el.classList.add('fade'));
      setTimeout(() => batch.forEach((el) => el.remove()), 700);
    }, ms);
  }
}

function trim() {
  const max = settings ? settings.maxMessages : 30;
  while (chat.children.length > max) chat.firstChild.remove();
}

function removeWhere(fn) {
  chat.querySelectorAll('.msg:not(.system)').forEach((el) => fn(el) && el.remove());
}

function system(text) {
  const el = document.createElement('div');
  el.className = 'msg system';
  el.textContent = text;
  push(el);
}

// ---------- Mensajes de prueba ----------

const SAMPLES = [
  ['Faker', '#FF4A80', '¡Qué jugada! Kappa'],
  ['ElMagoDelBot', '', 'baron en 30 segundos, cuidado'],
  ['Pepita_22', '#00BBF9', 'ese flash ha sido de cine Kappa Kappa'],
  ['xX_Jungla_Xx', '#5FFF77', 'gg ez'],
  ['Moderadora', '#FEE440', 'Recordad ser respetuosos en el chat 💜'],
];
let sampleIndex = 0;
function testMessage() {
  const [name, color, text] = SAMPLES[sampleIndex++ % SAMPLES.length];
  const chars = Array.from(text);
  const positions = [];
  for (let i = 0; i + 5 <= chars.length; i++) {
    if (chars.slice(i, i + 5).join('') === 'Kappa') positions.push(`${i}-${i + 4}`);
  }
  addMessage({
    id: '',
    user: name.toLowerCase(),
    name,
    color,
    emotes: positions.length ? `25:${positions.join(',')}` : '',
    text,
  });
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
api.onTestMessage(testMessage);
api.getSettings().then(applySettings);
loadGlobalEmotes();
