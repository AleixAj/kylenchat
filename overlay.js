// Chat window: connects to a Twitch chat (anonymous, read only) and draws the messages
// on a transparent window on top of the game.
// The other overlay/*.js files are loaded before this one and share its variables
// (emotes, 7TV paints, channel points, avatars and test mode).

const chat = document.getElementById('chat');

let settings = null;
const tr = (key, vars) => i18n.t(settings ? settings.language : 'es', key, vars);

// This window is the main chat or one of the "other chats" (it has ?win=<id> in its address).
const WIN_ID = new URLSearchParams(location.search).get('win') || '';

function myChannel(s) {
  if (!WIN_ID) return s.channel;
  const extra = (s.extraChats || []).find((c) => c.id === WIN_ID);
  return extra ? extra.channel : '';
}

// Returns the data, {} if the service answers that there is nothing (for example a 404: the
// channel doesn't use 7TV) or null if we couldn't connect. That way we know when it's worth trying again.
const getJSON = (url) => fetch(url)
  .then((r) => (r.ok ? r.json() : {}))
  .catch(() => null);

// ---------- Game styles ----------
// Each style changes the format of the line (channel tag, brackets, colors...).
// The shared data is in themes.js (also used by the settings window) and the look in themes.css.
const { THEMES } = GameThemes;

let lastDecor = null;

// Channel tag of the game styles. Only WoW shows it, as the role of who writes, like a WoW
// chat channel ("[1. User]", "[2. Sub]"...), unless the user typed their own text.
function channelTag(role) {
  if (settings.themeTag) return settings.themeTag;
  return `${GameThemes.WOW_CHANNEL_NUMBER[role]}. ${tr(`role_${role}`)}`;
}

// ---------- Look ----------

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
  root.setProperty('--val-broadcast', JSON.stringify(`(${tr('valBroadcast')}) `)); // Valorant: "(Broadcast) notice"
  document.body.classList.toggle('align-right', s.align === 'right');
  document.body.classList.toggle('newest-top', s.newestOnTop);
  for (const t of THEMES) document.body.classList.toggle(`theme-${t}`, s.theme === t);
  document.body.classList.toggle('themed', THEMES.includes(s.theme));
  document.body.classList.toggle('no-decor', !s.themeDecor); // "Game details" turned off
  // The decorative buttons only change with the game style.
  if (s.theme !== lastDecor) {
    lastDecor = s.theme;
    GameThemes.buildDecor(document.getElementById('decor'), s.theme);
  }
  resetIdle();
  document.getElementById('hint').textContent = tr('editHint', { keys: i18n.shortcutLabel(s.shortcuts.edit) });
  if (s.showViewers !== viewersShown) startViewers();
  trim();

  const channel = myChannel(s);
  if (channel !== joined) connect(channel);
}

// ---------- Connection to the Twitch chat (anonymous, read only) ----------

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
    // "justinfan" + a number is how Twitch lets you read a chat without an account.
    sock.send('PASS SCHMOOPIIE');
    sock.send(`NICK justinfan${Math.floor(10000 + Math.random() * 80000)}`);
    sock.send(`JOIN #${channel}`);
    // Twitch gives no error if the channel doesn't exist; it just never sends ROOMSTATE.
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
  // Retries with longer and longer waits (2, 4, 8... up to 30 s) so we don't flood when there is no internet.
  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null;
    if (retries === 0) system(tr('connectionLost'));
    const delay = Math.min(30000, 2000 * 2 ** retries);
    retries++;
    reconnectTimer = setTimeout(() => connect(joined), delay);
  };
}

// In the bar, the channel written the way the streamer writes it ("#AlvaroStorm"), not in lower case.
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
  // If the app started without internet, this is where we get the emotes that failed to download.
  if (!globalEmotesLoaded) loadGlobalEmotes();
  if (roomId && (roomId !== emotesRoomId || !channelEmotesLoaded)) loadChannelEmotes(roomId);
  if (roomId) connectPaints(roomId);
  if (roomId) connectPoints(roomId);
}

// Twitch sends a PING every ~5 min. If a long time goes by without anything (for example after
// the PC sleeps or the wifi changes), the connection is dead even if it doesn't look like it: open it again.
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
  // Paints connect again by themselves as soon as the chat joins the channel (onJoined).
}

function handle(m, sock) {
  switch (m.command) {
    case 'PING':
      sock.send(`PONG :${m.trailing || 'tmi.twitch.tv'}`);
      break;
    case 'PRIVMSG':
      if (!testMode) addMessage(messageFrom(m));
      break;
    case 'USERNOTICE': // subs, gifts, raids, announcements...
      if (!testMode) addNotice(noticeText(m.tags), m.trailing ? messageFrom(m) : null);
      break;
    case 'CLEARCHAT': // a moderator cleared the chat or banned someone
      if (m.trailing) moderate((el) => el.dataset.user === m.trailing.toLowerCase());
      else {
        moderate(() => true);
        if (settings.showDeleted) system(tr('chatCleared'));
      }
      break;
    case 'CLEARMSG': {
      // In shared chat, the deleted id can be the message id in its original channel.
      const target = m.tags['target-msg-id'];
      if (target) moderate((el) => el.dataset.id === target || el.dataset.sid === target);
      break;
    }
    case 'NOTICE':
      if (m.trailing) system(m.trailing);
      break;
    case 'RECONNECT': // Twitch warns that it's going to restart the server
      retries = 0;
      sock.close();
      break;
  }
}

// ---------- Viewers in the bar ----------
// Only while the channel is live. We ask every 30 s (a small request to api.ivr.fi,
// public and without an account), so it doesn't affect the ping.
let viewersTimer = null;
let viewersShown = null;

function startViewers() {
  clearInterval(viewersTimer);
  viewersShown = Boolean(settings && settings.showViewers);
  if (testMode) return; // test mode shows its own sample viewer count
  document.getElementById('barViewers').textContent = '';
  if (!viewersShown || !joined) return;
  updateViewers();
  viewersTimer = setInterval(updateViewers, 30000);
}

async function updateViewers() {
  const channel = joined;
  const data = await getJSON(`https://api.ivr.fi/v2/twitch/user?login=${encodeURIComponent(channel)}`);
  if (channel !== joined || !settings.showViewers) return; // something changed while waiting
  const stream = Array.isArray(data) && data[0] && data[0].stream;
  const count = stream && Number(stream.viewersCount);
  document.getElementById('barViewers').textContent = Number.isFinite(count) ? count.toLocaleString(settings.language) : '';
}

// ---------- Filters: muted users and bots ----------
// There is no word filter on purpose: the streamer has to see everything people write.

// Usual channel bots. They are hidden (together with "!something" commands) if the user wants.
const BOTS = new Set(['nightbot', 'streamelements', 'streamlabs', 'moobot', 'fossabot', 'wizebot', 'soundalerts', 'sery_bot', 'botrixoficial', 'kofistreambot', 'pokemoncommunitygame']);
const isBotMessage = ({ user, text }) => BOTS.has(user) || text.startsWith('!');

const escapeRegex = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const splitList = (text) => (text || '').split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
// Whole word (so "question" doesn't match inside "questions"), with or without @ in front.
const wordsRegex = (words) => (words.length
  ? new RegExp(`(^|[^\\p{L}\\p{N}_])@?(${words.map(escapeRegex).join('|')})(?=$|[^\\p{L}\\p{N}_])`, 'iu')
  : null);

let mutedKey = null;
let mutedUsers = new Set();

function isFiltered(msg) {
  if (settings.mutedUsers !== mutedKey) {
    mutedKey = settings.mutedUsers;
    mutedUsers = new Set(splitList(settings.mutedUsers).map((u) => u.replace(/^@/, '')));
  }
  return mutedUsers.has(msg.user) || (settings.hideBots && isBotMessage(msg));
}

// ---------- Highlights: mentions and keywords ----------

// Only built again when the settings or the channel change, not with every message.
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

// ---------- Messages on screen ----------

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

// Highlighted notice (subs, raids...), with the user's message below if it has one.
function addNotice(systemText, msg) {
  if (msg && isFiltered(msg)) msg = null; // the notice shows, but without the filtered message
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

// ---------- Shared chat ----------
// In streams with shared chat, each message says which channel it comes from
// (source-room-id) and we show that channel's icon. Each channel's data is asked
// only once to api.ivr.fi (public, no account) and kept in memory.
const channelInfo = new Map(); // channel id -> { name, logo }, or null while loading or if it fails

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

// Small label like "First message" or "500 bits".
function pill(kind, text) {
  const span = document.createElement('span');
  span.className = `pill pill-${kind}`;
  span.textContent = text;
  return span;
}

// Builds one chat line: time, avatar, tags, badges, name and text.
function fillMessage(el, msg) {
  const { id, user, name, color, emotes } = msg;
  let { text } = msg;
  // "/me" messages come wrapped like "\x01ACTION text\x01".
  let action = false;
  const me = text.match(/^\x01ACTION (.*)\x01$/);
  if (me) {
    text = me[1];
    action = true;
  }
  el.dataset.id = id || '';
  el.dataset.user = user || '';
  if (msg.sourceId) el.dataset.sid = msg.sourceId;

  const themed = THEMES.includes(settings.theme);
  const roles = new Set((msg.badges || '').split(',').map((b) => b.split('/')[0]));
  for (const role of ['broadcaster', 'moderator', 'vip', 'subscriber']) if (roles.has(role)) el.classList.add(`r-${role}`);
  const role = GameThemes.roleOf(roles);

  const nameEl = document.createElement('span');
  nameEl.className = 'name';
  nameEl.textContent = name;
  nameEl.dataset.role = tr(`role_${role}`); // LoL shows it like a champion: "Name (Sub)"
  // In the game styles the name always has its Twitch color, like in Twitch's chat.
  // People who never picked a color get a fixed one based on their name.
  if (themed || settings.userColors) nameEl.style.color = readable(color || GameThemes.colorFor(name));
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
    // In the game styles, 24 h clock like in a match (08:23, not 8:23 AM).
    time.textContent = new Date().toLocaleTimeString(settings.language, { hour: '2-digit', minute: '2-digit', hour12: themed ? false : undefined });
    el.append(time);
  }
  // Avatar with the first letter (Fortnite, Rust)
  const avatar = themed ? GameThemes.makeAvatar(settings.theme, name) : null;
  if (avatar) {
    el.prepend(avatar);
    if (msg.userId && msg.userId !== 'demo-paint') wantAvatar(msg.userId, avatar);
    else if (testMode) setAvatarImage(avatar, GameThemes.samplePicture(name)); // made up users: Twitch's default picture
  }
  // Channel tag of the game styles (only WoW): "[1. User]", "[2. Sub]"...
  if (themed && GameThemes.ROLE_TAG_THEMES.has(settings.theme)) {
    const chan = document.createElement('span');
    chan.className = 'chan';
    chan.textContent = channelTag(role);
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
  // Rank before the name (Minecraft, Rust), only for Sub, VIP, Mod and Streamer
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

// In very fast chats we don't draw each message when it arrives: we group them and
// update the screen at most ~6 times per second, and only with the ones that fit.
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

// "Dim when chat is quiet": after a while with no messages the chat becomes almost transparent
// (still readable) and gets its normal opacity back with the next message.
let idleTimer = null;
function resetIdle() {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  if (!settings || !settings.idleHide) return;
  idleTimer = setTimeout(() => {
    if (!testMode && !document.body.classList.contains('edit')) document.body.classList.add('idle');
  }, settings.idleHide * 1000);
}

// Short message on top of the chat, for example when switching profile with the shortcut.
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

// What a moderator deletes disappears, or stays as "message deleted" if the user prefers that.
// It affects the messages already drawn and the ones still waiting to be drawn.
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

// Grey line from the app itself ("Connecting...", "Connection lost"...).
function system(text) {
  if (testMode) return; // in test mode only the samples are shown
  const el = document.createElement('div');
  el.className = 'msg system';
  el.textContent = text;
  push(el);
}

// ---------- Start ----------

setupResizeGrip(document.getElementById('grip'));
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
