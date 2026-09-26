const chat = document.getElementById('chat');
const grip = document.getElementById('grip');

let settings = null;
const tr = (key, vars) => i18n.t(settings ? settings.language : 'es', key, vars);

// ---------- Colores ----------

// Color para usuarios que no han elegido ninguno en Twitch.
const colorFor = GameThemes.colorFor;

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

// Esta ventana es el chat principal o uno de los "otros chats" (lleva ?win=<id> en la dirección).
const WIN_ID = new URLSearchParams(location.search).get('win') || '';

function myChannel(s) {
  if (!WIN_ID) return s.channel;
  const chat = (s.extraChats || []).find((c) => c.id === WIN_ID);
  return chat ? chat.channel : '';
}

// ---------- Estilos de juegos ----------
// Cada estilo cambia el formato de la línea (etiqueta del canal, corchetes, colores...).
// Los colores están en themes.js (compartido con el panel) y el aspecto en themes.css.
const { THEMES } = GameThemes;

let lastDecor = '';

// ---------- Fotos de perfil (estilos con avatar: Fortnite, Rust) ----------
// Mientras llega la foto se ve la inicial. Las fotos que faltan se piden juntas a Twitch
// (hasta 100 por consulta, la misma que usa su web) y se recuerdan: cada persona, una sola vez.
const AVATAR_QUERY = 'query($ids:[ID!]){users(ids:$ids){id profileImageURL(width:70)}}';
const avatarCache = new Map(); // id de usuario -> dirección de la foto ('' si no tiene o no se pudo)
const avatarWaiting = new Map(); // id de usuario -> avatares que esperan su foto
let avatarTimer = null;

function wantAvatar(userId, el) {
  if (!/^\d{1,20}$/.test(userId || '')) return;
  const url = avatarCache.get(userId);
  if (url !== undefined) {
    if (url) setAvatarImage(el, url);
    return;
  }
  if (!avatarWaiting.has(userId)) avatarWaiting.set(userId, []);
  avatarWaiting.get(userId).push(el);
  if (!avatarTimer) avatarTimer = setTimeout(fetchAvatars, 300); // junta los de varios mensajes
}

async function fetchAvatars() {
  avatarTimer = null;
  const ids = [...avatarWaiting.keys()].slice(0, 100);
  if (!ids.length) return;
  let users = null;
  try {
    const res = await fetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: { 'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko', 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: AVATAR_QUERY, variables: { ids } }),
    });
    const body = await res.json();
    users = body && body.data && body.data.users;
  } catch { /* sin conexión: se queda la inicial y se reintenta con los siguientes mensajes */ }
  if (Array.isArray(users)) {
    if (avatarCache.size > 3000) avatarCache.clear(); // tope de memoria en directos muy largos
    for (const id of ids) avatarCache.set(id, '');
    for (const u of users) {
      const url = u && u.profileImageURL;
      if (typeof url === 'string' && /^https:\/\/static-cdn\.jtvnw\.net\/[\w\-./]+$/.test(url)) avatarCache.set(String(u.id), url);
    }
  }
  for (const id of ids) {
    const els = avatarWaiting.get(id) || [];
    avatarWaiting.delete(id);
    const url = avatarCache.get(id);
    if (url) for (const el of els) setAvatarImage(el, url);
  }
  if (avatarWaiting.size) avatarTimer = setTimeout(fetchAvatars, 300);
}

// La foto se pone cuando ya ha cargado, para no ver un hueco en blanco.
function setAvatarImage(el, url) {
  const img = new Image();
  img.onload = () => {
    el.style.backgroundImage = `url("${url}")`;
    el.classList.add('has-img');
  };
  img.src = url;
}

// Texto de la etiqueta del canal: el que haya puesto el usuario o el de cada juego.
// En WoW es el papel de quien escribe: [Usuario], [Sub], [VIP], [Mod] o [Streamer].
function channelTag(role) {
  if (settings.themeTag) return settings.themeTag;
  if (GameThemes.ROLE_TAG_THEMES.has(settings.theme)) return `${GameThemes.WOW_CHANNEL_NUMBER[role]}. ${tr(`role_${role}`)}`;
  return tr(`themeTag_${settings.theme}`) || '';
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
  root.setProperty('--bar-strong', hexToRgba(s.barColor, 0.38));
  root.setProperty('--bar-soft', hexToRgba(s.barColor, 0.12));
  root.setProperty('--bar-clear', hexToRgba(s.barColor, 0));
  root.setProperty('--emote', String(s.emoteScale));
  document.documentElement.lang = s.language;
  root.setProperty('--val-broadcast', JSON.stringify(`(${tr('valBroadcast')}) `)); // Valorant: "(Transmisión) aviso"
  document.body.classList.toggle('align-right', s.align === 'right');
  document.body.classList.toggle('newest-top', s.newestOnTop);
  for (const t of THEMES) document.body.classList.toggle(`theme-${t}`, s.theme === t);
  document.body.classList.toggle('themed', THEMES.includes(s.theme));
  document.body.classList.toggle('no-decor', !s.themeDecor); // "Detalles del juego" apagado
  const decorKey = `${s.theme}|${s.themeTag}|${s.language}`;
  if (decorKey !== lastDecor) {
    lastDecor = decorKey;
    GameThemes.buildDecor(document.getElementById('decor'), s.theme, THEMES.includes(s.theme) ? channelTag('user') : '', tr);
    showViewerCount();
  }
  resetIdle();
  document.getElementById('hint').textContent = tr('editHint', { keys: i18n.shortcutLabel(s.shortcuts.edit) });
  if (s.showViewers !== viewersShown) startViewers();
  trim();

  const channel = myChannel(s);
  if (channel !== joined) connect(channel);
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
    channelEmotesLoaded = false;
    retries = 0;
  }
  joined = channel;
  document.getElementById('barChannel').textContent = channel ? `#${channel}` : '';
  if (channel) showChannelName(channel);
  startViewers();
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

// En la barra, el canal escrito como lo escribe el streamer ("#AlvaroStorm"), no en minúsculas.
async function showChannelName(channel) {
  const data = await getJSON(`https://api.ivr.fi/v2/twitch/user?login=${encodeURIComponent(channel)}`);
  const name = Array.isArray(data) && data[0] && data[0].displayName;
  if (channel !== joined || typeof name !== 'string' || name.toLowerCase() !== channel) return;
  document.getElementById('barChannel').textContent = `#${name}`;
}

function onJoined(roomId) {
  clearTimeout(notFoundTimer);
  retries = 0;
  system(tr('connected', { channel: joined }));
  // Si la app arrancó sin internet, aquí se recuperan los emotes que no se pudieron bajar.
  if (!globalEmotesLoaded) loadGlobalEmotes();
  if (roomId && (roomId !== emotesRoomId || !channelEmotesLoaded)) loadChannelEmotes(roomId);
  if (roomId) connectPaints(roomId);
  if (roomId) connectPoints(roomId);
}

// ---------- Pinturas de 7TV (nombres en degradado) ----------
// Twitch no manda estos colores: son de 7TV. Su canal de eventos avisa, para el chat en el
// que estamos, de qué pintura lleva cada persona (entitlement) y cómo es cada pintura
// (cosmetic). Se guarda todo en memoria y se aplica al nombre al pintarlo.
const paintCss = new Map();  // id de la pintura -> estilos CSS
const userPaint = new Map(); // id de Twitch del usuario -> id de la pintura
let paintSocket = null;
let paintRoom = null;
let paintRetry = 0;
let paintTimer = null;

// 7TV guarda los colores como un entero RGBA de 32 bits.
function rgba(n) {
  const c = n >>> 0;
  return `rgba(${(c >>> 24) & 255}, ${(c >>> 16) & 255}, ${(c >>> 8) & 255}, ${((c & 255) / 255).toFixed(3)})`;
}

function paintToCss(p) {
  const stops = (p.stops || []).map((s) => `${rgba(s.color)} ${Math.round(s.at * 1000) / 10}%`).join(', ');
  const rep = p.repeat ? 'repeating-' : '';
  let image = null;
  if (p.function === 'LINEAR_GRADIENT' && stops) image = `${rep}linear-gradient(${Number(p.angle) || 0}deg, ${stops})`;
  else if (p.function === 'RADIAL_GRADIENT' && stops) image = `${rep}radial-gradient(${p.shape === 'ellipse' ? 'ellipse' : 'circle'}, ${stops})`;
  else if (p.function === 'URL' && /^https:\/\/cdn\.7tv\.app\//.test(p.image_url || '')) image = `url("${p.image_url}")`;
  if (!image) return null;
  const shadows = (p.shadows || []).slice(0, 4)
    .map((s) => `drop-shadow(${s.x_offset}px ${s.y_offset}px ${s.radius}px ${rgba(s.color)})`).join(' ');
  return { image, shadows, url: p.function === 'URL' };
}

// Aplica la pintura al nombre si la hay; si no, se queda con su color normal.
function applyPaint(nameEl) {
  const css = settings.userColors && paintCss.get(userPaint.get(nameEl.dataset.uid));
  if (!css) return;
  nameEl.classList.add('painted');
  nameEl.style.backgroundImage = css.image;
  nameEl.style.backgroundSize = css.url ? 'cover' : '';
  nameEl.style.filter = css.shadows || '';
}

function repaintUser(userId) {
  document.querySelectorAll(`.name[data-uid="${userId}"]`).forEach(applyPaint);
}

function onPaintEvent(type, object) {
  if (!object) return;
  if (type === 'cosmetic.create' && object.kind === 'PAINT' && object.data) {
    const css = paintToCss(object.data);
    if (css) paintCss.set(object.id, css);
    return;
  }
  if (object.kind !== 'PAINT' || !object.user) return;
  const twitch = (object.user.connections || []).find((c) => c.platform === 'TWITCH');
  if (!twitch) return;
  if (type === 'entitlement.create') userPaint.set(twitch.id, object.ref_id);
  else if (type === 'entitlement.delete' && userPaint.get(twitch.id) === object.ref_id) userPaint.delete(twitch.id);
  repaintUser(twitch.id);
}

function connectPaints(roomId) {
  clearTimeout(paintTimer);
  if (paintSocket && paintRoom === roomId) return;
  if (paintSocket) {
    paintSocket.onclose = null;
    paintSocket.close();
  }
  if (paintRoom !== roomId) {
    // Las pinturas de usuarios del canal anterior ya no hacen falta (se conserva la de ejemplo).
    for (const id of userPaint.keys()) if (id !== 'demo-paint') userPaint.delete(id);
  }
  paintRoom = roomId;
  const sock = new WebSocket('wss://events.7tv.io/v3');
  paintSocket = sock;
  sock.onopen = () => {
    paintRetry = 0;
    for (const type of ['cosmetic.*', 'entitlement.*']) {
      sock.send(JSON.stringify({ op: 35, d: { type, condition: { ctx: 'channel', platform: 'TWITCH', id: roomId } } }));
    }
  };
  sock.onmessage = (e) => {
    try {
      const m = JSON.parse(e.data);
      if (m.op === 0 && m.d && m.d.body) onPaintEvent(m.d.type, m.d.body.object);
    } catch { /* mensaje raro: se ignora */ }
  };
  // Si se corta, se reintenta con esperas crecientes (las pinturas son un extra, sin prisa).
  sock.onclose = () => {
    if (paintSocket !== sock) return;
    paintSocket = null;
    paintTimer = setTimeout(() => connectPaints(roomId), Math.min(60000, 5000 * 2 ** paintRetry++));
  };
}

// ---------- Canjes de puntos del canal ----------
// Twitch solo manda por el chat los canjes que llevan un mensaje escrito. Los demás
// ("hidrátate", "elige mi campeón"...) se reciben escuchando los eventos públicos del canal,
// igual que hace la web de Twitch, sin iniciar sesión. Son mensajes pequeños y poco frecuentes.
const POINTS_URL = 'wss://hermes.twitch.tv/v1?clientId=kimne78kx3ncx6brgo4mv6wki5h1ko';
let pointsSocket = null;
let pointsRoom = null;
let pointsTimer = null;
let pointsRetry = 0;
let pointsLastMessage = 0;
const rewardTitles = new Map(); // id de recompensa -> nombre, para los canjes que llegan con mensaje

function connectPoints(roomId) {
  clearTimeout(pointsTimer);
  if (pointsSocket && pointsRoom === roomId) return;
  if (pointsSocket) {
    pointsSocket.onclose = null;
    pointsSocket.close();
  }
  if (pointsRoom !== roomId) rewardTitles.clear();
  pointsRoom = roomId;
  const sock = new WebSocket(POINTS_URL);
  pointsSocket = sock;
  pointsLastMessage = Date.now();
  sock.onmessage = (e) => {
    pointsLastMessage = Date.now();
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    if (m.type === 'welcome') {
      pointsRetry = 0;
      sock.send(JSON.stringify({
        type: 'subscribe',
        id: 'points',
        subscribe: { id: 'points', type: 'pubsub', pubsub: { topic: `community-points-channel-v1.${roomId}` } },
        timestamp: new Date().toISOString(),
      }));
    } else if (m.type === 'notification' && m.notification && typeof m.notification.pubsub === 'string') {
      try { onPointsEvent(JSON.parse(m.notification.pubsub)); } catch { /* evento raro: se ignora */ }
    }
  };
  // Si se corta, se reintenta con esperas crecientes.
  sock.onclose = () => {
    if (pointsSocket !== sock) return;
    pointsSocket = null;
    pointsTimer = setTimeout(() => connectPoints(roomId), Math.min(60000, 5000 * 2 ** pointsRetry++));
  };
}

// Twitch manda una señal cada 10-15 s. Si pasan 45 s sin nada, la conexión está muerta: se rehace.
setInterval(() => {
  if (pointsSocket && Date.now() - pointsLastMessage > 45000) pointsSocket.close();
}, 15000);

function onPointsEvent(event) {
  if (!event || event.type !== 'reward-redeemed') return;
  const red = event.data && event.data.redemption;
  if (!red || !red.reward || !red.user || String(red.channel_id) !== String(pointsRoom)) return;
  if (typeof red.reward.id === 'string' && typeof red.reward.title === 'string') {
    rewardTitles.set(red.reward.id, red.reward.title);
    if (rewardTitles.size > 300) rewardTitles.delete(rewardTitles.keys().next().value);
  }
  if (red.user_input) return; // este llega por el chat con su mensaje y la etiqueta de canje
  if (testMode || !settings.showRedemptions) return;
  const login = String(red.user.login || '').toLowerCase();
  if (isFiltered({ user: login, text: '' })) return;
  addRedeemNotice({
    name: red.user.display_name || login,
    title: String(red.reward.title || ''),
    cost: Number(red.reward.cost) || 0,
    color: /^#[0-9a-f]{6}$/i.test(red.reward.background_color) ? red.reward.background_color : '#9146ff',
  });
}

function addRedeemNotice({ name, title, cost, color }) {
  const el = document.createElement('div');
  el.className = 'msg notice redeem-notice';
  el.style.setProperty('--edge', color);
  const text = document.createElement('div');
  text.className = 'notice-title';
  text.textContent = tr('noticeRedeem', { name, reward: title, cost: cost.toLocaleString(settings.language) });
  el.append(text);
  push(el);
}

// ---------- Espectadores en la barra ----------
// Solo mientras el canal está en directo. Se consulta cada 30 s (una petición pequeña
// a api.ivr.fi, pública y sin cuenta), así que no afecta al ping.
let viewersTimer = null;
let viewersShown = null;

function startViewers() {
  clearInterval(viewersTimer);
  viewersShown = Boolean(settings && settings.showViewers);
  document.getElementById('barViewers').textContent = '';
  if (!viewersShown || !joined) return;
  updateViewers();
  viewersTimer = setInterval(updateViewers, 30000);
}

async function updateViewers() {
  const channel = joined;
  const data = await getJSON(`https://api.ivr.fi/v2/twitch/user?login=${encodeURIComponent(channel)}`);
  if (channel !== joined || !settings.showViewers) return; // cambió algo mientras esperaba
  const stream = Array.isArray(data) && data[0] && data[0].stream;
  const count = stream && Number(stream.viewersCount);
  document.getElementById('barViewers').textContent = Number.isFinite(count) ? count.toLocaleString(settings.language) : '';
  showViewerCount();
}

// En el estilo WoW, los espectadores van en el botón de amigos (como el número de amigos conectados).
function showViewerCount() {
  const count = document.querySelector('#decor .wow-count');
  if (count) count.textContent = document.getElementById('barViewers').textContent;
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
  if (paintSocket) {
    paintSocket.onclose = null;
    paintSocket.close();
    paintSocket = null;
  }
  // Las pinturas se vuelven a conectar solas en cuanto el chat entra en el canal (onJoined).
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
  const { tags } = m;
  const user = tags.login || m.prefix.split('!')[0];
  return {
    id: tags.id,
    user,
    name: tags['display-name'] || user,
    color: tags.color,
    emotes: tags.emotes,
    text: m.trailing || '',
    userId: tags['user-id'] || '',
    // En chat compartido las insignias del canal de origen vienen en source-badges.
    badges: tags['source-badges'] || tags.badges || '',
    sourceRoom: tags['source-room-id'] || '',
    sourceId: tags['source-id'] || '',
    first: tags['first-msg'] === '1',
    bits: Number(tags.bits) || 0,
    highlighted: tags['msg-id'] === 'highlighted-message',
    redeem: Boolean(tags['custom-reward-id']),
    rewardId: tags['custom-reward-id'] || '',
    reply: tags['reply-parent-display-name']
      ? { name: tags['reply-parent-display-name'], body: unescapeTag(tags['reply-parent-msg-body'] || '') }
      : null,
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
      if (!testMode) addNotice(noticeText(m.tags), m.trailing ? messageFrom(m) : null);
      break;
    case 'CLEARCHAT': // un moderador ha borrado el chat o baneado a alguien
      if (m.trailing) moderate((el) => el.dataset.user === m.trailing.toLowerCase());
      else {
        moderate(() => true);
        if (settings.showDeleted) system(tr('chatCleared'));
      }
      break;
    case 'CLEARMSG': {
      // En chat compartido el borrado puede referirse al id del mensaje en su canal de origen.
      const target = m.tags['target-msg-id'];
      if (target) moderate((el) => el.dataset.id === target || el.dataset.sid === target);
      break;
    }
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
let globalEmotesLoaded = false;  // false si falló la descarga (p. ej. sin internet): se reintenta
let channelEmotesLoaded = false;

// Devuelve los datos, {} si el servicio responde que no hay nada (p. ej. 404: el canal no usa
// 7TV) o null si no se pudo conectar. Así se sabe cuándo merece la pena reintentar.
const getJSON = (url) => fetch(url)
  .then((r) => (r.ok ? r.json() : {}))
  .catch(() => null);

function add7tv(map, list) {
  for (const e of Array.isArray(list) ? list : []) {
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
  for (const e of Array.isArray(list) ? list : []) {
    const base = `https://cdn.betterttv.net/emote/${e.id}`;
    map.set(e.code, { url: `${base}/2x.webp`, still: e.animated ? `${base}/static/2x.webp` : null });
  }
}
function addFfz(map, list) {
  for (const e of Array.isArray(list) ? list : []) {
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
  globalEmotesLoaded = Boolean(stv || bttv || ffz);
}

async function loadChannelEmotes(roomId) {
  emotesRoomId = roomId;
  const [stv, bttv, ffz] = await Promise.all([
    getJSON(`https://7tv.io/v3/users/twitch/${roomId}`),
    getJSON(`https://api.betterttv.net/3/cached/users/twitch/${roomId}`),
    getJSON(`https://api.betterttv.net/3/cached/frankerfacez/users/twitch/${roomId}`),
  ]);
  if (emotesRoomId !== roomId) return; // se cambió de canal mientras cargaba
  // 404 = el canal no usa ese servicio (normal); null en los tres = sin conexión: se reintentará.
  channelEmotesLoaded = Boolean(stv || bttv || ffz);
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

const escapeRegex = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const splitList = (text) => (text || '').split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
// Palabra completa (sin cortar "pregunta" dentro de "preguntas"), con o sin @ delante.
const wordsRegex = (words) => (words.length
  ? new RegExp(`(^|[^\\p{L}\\p{N}_])@?(${words.map(escapeRegex).join('|')})(?=$|[^\\p{L}\\p{N}_])`, 'iu')
  : null);

// ---------- Filtros: usuarios silenciados y bots ----------
// No hay filtro de palabras a propósito: el streamer tiene que ver todo lo que le escriben.

let mutedKey = null;
let mutedUsers = new Set();

function isFiltered(msg) {
  if (settings.mutedUsers !== mutedKey) {
    mutedKey = settings.mutedUsers;
    mutedUsers = new Set(splitList(settings.mutedUsers).map((u) => u.replace(/^@/, '')));
  }
  return mutedUsers.has(msg.user) || (settings.hideBots && isBotMessage(msg));
}

// ---------- Destacados: menciones y palabras clave ----------

// Se vuelve a construir solo cuando cambian los ajustes o el canal, no con cada mensaje.
let mentionRegex = null;
let mentionKey = '';
function getMentionRegex() {
  const target = settings.channel || joined || (testMode ? 'streamer' : '');
  const words = splitList(settings.keywords);
  if (settings.highlightMentions && target) words.push(target);
  const key = words.join(',');
  if (key !== mentionKey) {
    mentionKey = key;
    mentionRegex = wordsRegex(words);
  }
  return mentionRegex;
}

function isMention(text) {
  const re = getMentionRegex();
  return re ? re.test(text) : false;
}

function addMessage(msg) {
  if (isFiltered(msg)) return;
  const el = document.createElement('div');
  el.className = 'msg';
  if (isMention(msg.text)) el.classList.add('mention');
  if (msg.first && settings.highlightFirst) el.classList.add('first');
  if (msg.highlighted) el.classList.add('highlighted');
  if (msg.bits) el.classList.add('bits');
  fillMessage(el, msg);
  push(el);
}

// Aviso destacado: "X se ha suscrito", "Y está haciendo raid con 50 espectadores"...
// Twitch manda el texto de los avisos solo en inglés ("system-msg"). Para los tipos
// conocidos se construye en el idioma de la app con los datos del aviso; para el resto
// se usa el texto de Twitch tal cual.
const ANON_GIFTERS = new Set(['ananonymousgifter', 'ananonymouscheerer']);

function noticeText(tags) {
  const p = (key) => unescapeTag(tags[`msg-param-${key}`] || '');
  const user = unescapeTag(tags['display-name'] || tags.login || '');
  const name = ANON_GIFTERS.has(tags.login) ? tr('anonymous') : user;
  const planCode = p('sub-plan');
  const plan = planCode === 'Prime' ? tr('planPrime') : tr('planTier', { n: String(Number(planCode) / 1000 || 1) });
  const months = Number(p('cumulative-months')) || 0;
  const sender = p('sender-name') || p('prior-gifter-display-name');

  // Los avisos que llegan de otro canal del chat compartido traen su tipo real en source-msg-id.
  const type = tags['msg-id'] === 'sharedchatnotice' ? tags['source-msg-id'] : tags['msg-id'];
  switch (type) {
    case 'sub':
      return tr('noticeSub', { name, plan });
    case 'resub':
      return months > 1 ? tr('noticeResub', { name, plan, months }) : tr('noticeSub', { name, plan });
    case 'subgift': {
      const giftMonths = Number(p('gift-months')) || 1;
      const recipient = p('recipient-display-name');
      return giftMonths > 1
        ? tr('noticeSubGiftMonths', { name, plan, recipient, months: giftMonths })
        : tr('noticeSubGift', { name, plan, recipient });
    }
    case 'submysterygift':
      return tr('noticeMysteryGift', { name, plan, count: p('mass-gift-count') });
    case 'raid':
      return tr('noticeRaid', { name: p('displayName') || user, count: p('viewerCount') });
    case 'viewermilestone':
      if (p('category') === 'watch-streak') return tr('noticeWatchStreak', { name, count: p('value') });
      break;
    case 'giftpaidupgrade':
      return tr('noticeGiftUpgrade', { name, sender });
    case 'anongiftpaidupgrade':
      return tr('noticeGiftUpgradeAnon', { name });
    case 'primepaidupgrade':
      return tr('noticePrimeUpgrade', { name, plan });
    case 'bitsbadgetier':
      return tr('noticeBitsBadge', { name, count: p('threshold') });
    case 'standardpayforward':
      return tr('noticePayForward', { name, sender });
    case 'communitypayforward':
      return tr('noticePayForwardCommunity', { name, sender });
  }
  return unescapeTag(tags['system-msg'] || '');
}

function addNotice(systemText, msg) {
  if (msg && isFiltered(msg)) msg = null; // el aviso se ve, pero sin el mensaje filtrado
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
    if (line.dataset.sid) el.dataset.sid = line.dataset.sid;
    el.append(line);
  }
  push(el);
}

const BADGE_ORDER = ['broadcaster', 'moderator', 'vip', 'subscriber'];

function badgeIcons(badges) {
  const have = new Set(badges.split(',').map((b) => b.split('/')[0]).map((b) => (b === 'founder' ? 'subscriber' : b)));
  return BADGE_ORDER.filter((b) => have.has(b)).map((b) => {
    const img = document.createElement('img');
    img.className = 'badge';
    img.src = `assets/badges/${b}.svg`;
    img.alt = '';
    return img;
  });
}

// ---------- Chat compartido ----------
// En los directos con chat compartido, cada mensaje indica de qué canal viene
// (source-room-id) y se muestra el icono de ese canal. Los datos de cada canal se
// piden una sola vez a api.ivr.fi (pública, sin cuenta) y se guardan en memoria.
const channelInfo = new Map(); // id del canal -> { name, logo }, o null mientras carga o si falla

function channelIcon(roomId) {
  const img = document.createElement('img');
  img.className = 'channel-icon';
  img.dataset.room = roomId;
  img.alt = '';
  const info = channelInfo.get(roomId);
  if (info) applyChannelInfo(img, info);
  else if (!channelInfo.has(roomId) && /^\d{1,20}$/.test(roomId)) loadChannelInfo(roomId);
  return img;
}

function applyChannelInfo(img, info) {
  img.src = info.logo;
  img.alt = img.title = info.name;
}

async function loadChannelInfo(roomId) {
  channelInfo.set(roomId, null);
  const data = await getJSON(`https://api.ivr.fi/v2/twitch/user?id=${roomId}`);
  const user = Array.isArray(data) && data[0];
  if (!user || typeof user.logo !== 'string' || !user.logo.startsWith('https://static-cdn.jtvnw.net/')) return;
  const info = { name: user.displayName || user.login, logo: user.logo.replace('600x600', '70x70') };
  channelInfo.set(roomId, info);
  document.querySelectorAll(`img.channel-icon[data-room="${roomId}"]`).forEach((img) => applyChannelInfo(img, info));
}

function pill(kind, text) {
  const span = document.createElement('span');
  span.className = `pill pill-${kind}`;
  span.textContent = text;
  return span;
}

function fillMessage(el, msg) {
  const { id, user, name, color, emotes } = msg;
  let { text } = msg;
  let action = false;
  const me = text.match(/^\x01ACTION (.*)\x01$/);
  if (me) {
    text = me[1];
    action = true;
  }
  if (action) el.classList.add('action');
  el.dataset.id = id || '';
  el.dataset.user = user || '';
  if (msg.sourceId) el.dataset.sid = msg.sourceId;

  const themed = THEMES.includes(settings.theme);
  const roles = new Set((msg.badges || '').split(',').map((b) => b.split('/')[0]));
  for (const role of ['broadcaster', 'moderator', 'vip', 'subscriber']) if (roles.has(role)) el.classList.add(`r-${role}`);
  const role = GameThemes.roleOf(roles);
  if (themed && !settings.themeTag && GameThemes.ROLE_TAG_THEMES.has(settings.theme)) el.classList.add(`ch-${role}`);

  const nameEl = document.createElement('span');
  nameEl.className = 'name';
  nameEl.textContent = name;
  nameEl.dataset.role = tr(`role_${GameThemes.roleOf(roles)}`); // LoL lo pone como campeón: "Nombre (Sub)"
  // En los estilos de juegos el nombre lleva siempre su color de Twitch, como en el chat de Twitch.
  if (themed || settings.userColors) nameEl.style.color = readable(color || colorFor(name));
  if (msg.userId) {
    nameEl.dataset.uid = msg.userId;
    applyPaint(nameEl);
  }

  const textEl = document.createElement('span');
  textEl.className = 'text';
  if (action && settings.userColors) textEl.style.color = nameEl.style.color;
  renderText(textEl, text, emotes);

  if (msg.reply) {
    const reply = document.createElement('div');
    reply.className = 'reply';
    reply.textContent = `↪ ${tr('replyingTo', { name: msg.reply.name })}: ${msg.reply.body}`;
    el.append(reply);
  }
  if (settings.timestamps || (themed && GameThemes.TIME_THEMES.has(settings.theme))) {
    const time = document.createElement('span');
    time.className = 'time';
    // En los estilos de juegos, reloj de 24 h como en las partidas (08:23, no 8:23 AM)
    time.textContent = new Date().toLocaleTimeString(settings.language, { hour: '2-digit', minute: '2-digit', hour12: themed ? false : undefined });
    el.append(time);
  }
  // Avatar con la inicial (Fortnite, Rust)
  const avatar = themed ? GameThemes.makeAvatar(settings.theme, name) : null;
  if (avatar) {
    el.prepend(avatar);
    if (msg.userId && msg.userId !== 'demo-paint') wantAvatar(msg.userId, avatar);
    else if (testMode) setAvatarImage(avatar, GameThemes.samplePicture(name)); // usuarios inventados: foto por defecto de Twitch
  }
  // Etiqueta del canal de los estilos de juegos: "[Usuario]", "[Todos]"...
  const tag = themed ? channelTag(role) : '';
  if (tag) {
    const chan = document.createElement('span');
    chan.className = 'chan';
    chan.textContent = tag;
    if (GameThemes.TAG_LIKE_NAME_THEMES.has(settings.theme) && nameEl.style.color) chan.style.color = nameEl.style.color;
    el.append(chan);
  }
  if (msg.first && settings.highlightFirst) el.append(pill('first', tr('firstMessage')));
  if (msg.bits) el.append(pill('bits', tr('bits', { n: msg.bits })));
  if (msg.highlighted) el.append(pill('highlighted', tr('highlightedMessage')));
  if (msg.redeem) {
    const title = msg.rewardTitle || rewardTitles.get(msg.rewardId);
    el.append(pill('redeem', title ? `${tr('redeemed')} · ${title}` : tr('redeemed')));
  }
  if (msg.sourceRoom) el.append(channelIcon(msg.sourceRoom));
  if (settings.showBadges && msg.badges) el.append(...badgeIcons(msg.badges));
  // Rango delante del nombre (Minecraft, Rust), solo para Sub, VIP, Mod y Streamer
  if (themed && role !== 'user' && GameThemes.RANK_THEMES.has(settings.theme)) {
    const rank = document.createElement('span');
    rank.className = 'rank';
    rank.textContent = tr(`role_${role}`);
    if (settings.theme === 'rust' && nameEl.style.color) rank.style.color = nameEl.style.color;
    el.append(rank);
  }
  const sep = document.createElement('span');
  sep.className = 'sep';
  sep.textContent = action ? ' ' : ': ';
  el.append(nameEl, sep, textEl);
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

// Con "Emotes animados" apagado se usa la versión quieta, que gasta menos CPU.
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
  if (batch.length) resetIdle();
  if (settings && settings.fadeAfter > 0) {
    setTimeout(() => {
      batch.forEach((el) => el.classList.add('fade'));
      setTimeout(() => batch.forEach((el) => el.remove()), 700);
    }, settings.fadeAfter * 1000);
  }
}

// "Atenuar si no hay mensajes": tras un rato sin actividad el chat se vuelve casi transparente
// (sigue legible) y recupera la opacidad normal con el siguiente mensaje.
let idleTimer = null;
function resetIdle() {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  if (!settings || !settings.idleHide) return;
  idleTimer = setTimeout(() => {
    if (!testMode && !document.body.classList.contains('edit')) document.body.classList.add('idle');
  }, settings.idleHide * 1000);
}

// Aviso breve encima del chat, p. ej. al cambiar de perfil con el atajo.
let toastTimer = null;
function showToast(text) {
  const toast = document.getElementById('toast');
  toast.textContent = text;
  toast.classList.add('show');
  resetIdle();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
}

function trim() {
  const max = settings ? settings.maxMessages : 30;
  while (chat.children.length > max) chat.firstChild.remove();
}

// Lo que borra un moderador: desaparece, o se queda como «mensaje borrado» si el usuario lo
// prefiere. Afecta a lo ya pintado y a lo que está esperando a pintarse.
function moderate(fn) {
  const matches = (el) => !el.classList.contains('system') && fn(el);
  if (settings.showDeleted) {
    pending.filter(matches).forEach(markDeleted);
    [...chat.children].filter(matches).forEach(markDeleted);
    return;
  }
  pending = pending.filter((el) => !matches(el));
  for (const el of [...chat.children]) if (matches(el)) el.remove();
}

function markDeleted(el) {
  if (el.classList.contains('deleted')) return;
  el.classList.add('deleted');
  el.querySelectorAll('.reply').forEach((reply) => reply.remove());
  el.querySelectorAll('.text').forEach((text) => text.replaceChildren(tr('deletedMessage')));
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

// Pintura de ejemplo (degradado rosa-morado-azul) para enseñarlas en el modo prueba.
paintCss.set('demo', paintToCss({ function: 'LINEAR_GRADIENT', angle: 90, stops: [
  { at: 0, color: 0xff5fa2ff }, { at: 0.5, color: 0xb070ffff }, { at: 1, color: 0x4fc3ffff },
] }));
userPaint.set('demo-paint', 'demo');

function sampleMessage([name, color, rawText, extras]) {
  const text = rawText.split('{channel}').join(joined || 'streamer');
  const byId = {};
  let pos = 0;
  for (const word of text.split(' ')) {
    const len = Array.from(word).length;
    const id = TWITCH_TEST_EMOTES[word];
    if (id) (byId[id] = byId[id] || []).push(`${pos}-${pos + len - 1}`);
    pos += len + 1;
  }
  const emotes = Object.entries(byId).map(([id, ranges]) => `${id}:${ranges.join(',')}`).join('/');
  return { id: '', user: name.toLowerCase(), name, color, emotes, text, badges: '', ...extras };
}

function testMessage() {
  const list = samples();
  const sample = list[sampleIndex++ % list.length];
  if (Array.isArray(sample)) addMessage(sampleMessage(sample));
  else if (sample.redeem) { if (settings.showRedemptions) addRedeemNotice(sample.redeem); }
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
api.onEditMode((on) => {
  document.body.classList.toggle('edit', on);
  resetIdle();
});
api.onToast(showToast);
api.onTestMode(setTestMode);
api.onReconnect(reconnectNow);
api.getSettings().then(applySettings);
loadGlobalEmotes();
