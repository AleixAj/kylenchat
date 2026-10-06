// Emotes in the chat: Twitch's own ones (Twitch tells us where they are in the text)
// and the ones from 7TV, BTTV and FFZ (we look for them word by word).
// The 7TV, BTTV and FFZ lists are downloaded once per channel and kept in memory,
// so finding a word is instant.

let globalEmotes = new Map();
let channelEmotes = new Map();
let emotesRoomId = null;
let globalEmotesLoaded = false;  // false if the download failed (for example, no internet): we try again
let channelEmotesLoaded = false;

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
  // If two services use the same word, the one added last wins (7TV).
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
  if (emotesRoomId !== roomId) return; // the channel changed while loading
  // 404 means the channel doesn't use that service (normal). null in all three means no connection: we'll try again.
  channelEmotesLoaded = Boolean(stv || bttv || ffz);
  const map = new Map();
  addFfz(map, ffz);
  addBttv(map, bttv && [...(bttv.channelEmotes || []), ...(bttv.sharedEmotes || [])]);
  add7tv(map, stv && stv.emote_set && stv.emote_set.emotes);
  channelEmotes = map;
}

const findEmote = (word) => channelEmotes.get(word) || globalEmotes.get(word);

// Replaces the parts of the text that Twitch marks as emotes with their image.
// Twitch gives positions like "25:0-4,12-16" (emote id: start-end), counted in characters.
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
    if (r.a < i) continue; // repeated or overlapping range
    if (r.a > i) appendWords(parent, chars.slice(i, r.a).join(''));
    const base = `https://static-cdn.jtvnw.net/emoticons/v2/${r.emoteId}`;
    const emote = { url: `${base}/default/dark/2.0`, still: `${base}/static/dark/2.0` };
    parent.append(emoteImg(emote, chars.slice(r.a, r.b + 1).join('')));
    i = r.b + 1;
  }
  if (i < chars.length) appendWords(parent, chars.slice(i).join(''));
}

// Looks for 7TV, BTTV and FFZ emotes word by word.
function appendWords(parent, str) {
  let buf = '';
  for (const word of str.split(/(\s+)/)) {
    const emote = word && findEmote(word);
    if (!emote) {
      buf += word;
      continue;
    }
    // 7TV "zero-width" emotes are drawn on top of the previous emote.
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

// With "Animated emotes" turned off we use the still version, which uses less CPU.
function emoteImg(emote, name) {
  const img = document.createElement('img');
  img.className = 'emote';
  img.decoding = 'async';
  img.alt = img.title = name;
  img.onerror = () => img.replaceWith(name); // if it doesn't load, show the word instead of a broken icon
  img.src = settings.animatedEmotes || !emote.still ? emote.url : emote.still;
  return img;
}

function isEmoteNode(node) {
  return node && node.nodeType === 1 && (node.classList.contains('emote') || node.classList.contains('stack'));
}

// Puts an emote on top of another one (or of a stack that already has several).
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
