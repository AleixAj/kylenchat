// Default settings and the rules for each setting.
// Everything that comes from disk, from an imported file or from a window goes
// through sanitize(), so a broken or edited settings.json can't crash the app.
const { LANGUAGES, DEFAULT_SHORTCUTS } = require('../i18n');

const DEFAULTS = {
  language: 'es',
  channel: '',
  fontSize: 15,
  fontFamily: 'Segoe UI',
  bold: false,
  textColor: '#ffffff',
  userColors: true,
  bgColor: '#000000',
  bgOpacity: 25,
  barColor: '#9146ff',
  showViewers: true,
  outline: true,
  opacity: 100,
  maxMessages: 20,
  fadeAfter: 0,
  animatedEmotes: true,
  hideBots: false,
  highlightMentions: true,
  keywords: '',
  highlightFirst: true,
  showRedemptions: true,
  showBadges: true,
  timestamps: false,
  mutedUsers: '',
  liveChannels: '',
  liveDuration: 8,
  liveSound: true,
  liveVolume: 70,
  alertBounds: null,
  showDeleted: false,
  shortcuts: { ...DEFAULT_SHORTCUTS },
  align: 'left',
  newestOnTop: false,
  idleHide: 120,
  emoteScale: 1.6,
  autoStart: false,
  bounds: null,
  profiles: [],
  customStyles: [],
  theme: '', // game style: '' (none) or one of the games in themes.js
  themeTag: '', // channel tag text; empty means the game's own tag
  themeDecor: true, // decorative game details (buttons and tabs)
  chatVisible: true, // the main chat window is shown (it can be hidden to keep only the live alerts)
  extraChats: [], // other chats in their own windows: { id, channel, visible, bounds }
  activeProfile: '',
  onboarded: false,
  lastVersion: '',
};

// What a profile saves: the look and the position. Channel, language and filters are shared.
const PROFILE_KEYS = [
  'fontSize', 'fontFamily', 'bold', 'textColor', 'userColors', 'bgColor', 'bgOpacity', 'barColor', 'outline', 'opacity',
  'maxMessages', 'fadeAfter', 'animatedEmotes', 'showBadges', 'timestamps', 'align', 'newestOnTop', 'idleHide',
  'emoteScale', 'theme', 'themeTag', 'themeDecor', 'bounds',
];
// Settings that are not exported or imported, because they only make sense on this PC.
const LOCAL_KEYS = ['autoStart', 'onboarded', 'lastVersion', 'chatVisible', 'extraChats'];

const PROFILES_MAX = 10;
// Color for the tag of profiles saved before the user could pick one.
const PROFILE_COLOR = '#9146ff';
const STYLES_MAX = 20;
// Extra chat windows, on top of the main one.
const EXTRA_CHATS_MAX = 3;

// Small checks used by the rules below.
const isBool = (v) => typeof v === 'boolean';
const isHex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const inRange = (min, max) => (v) => Number.isFinite(v) && v >= min && v <= max;
const isText = (max) => (v) => typeof v === 'string' && v.length <= max && !/[\u0000-\u001f]/.test(v);
const isBounds = (v) => v === null || (v && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(v[k])));
const isProfileName = isText(30);

// A valid shortcut is Ctrl and/or Alt (Shift optional) plus a letter or number,
// or an F1-F24 key on its own or with modifiers.
const isAccelerator = (v) => {
  const m = typeof v === 'string' && /^(CommandOrControl\+)?(Alt\+)?(Shift\+)?([A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4]))$/.exec(v);
  return Boolean(m) && (Boolean(m[1] || m[2]) || m[4].length > 1);
};
// Every action needs a valid shortcut, and two actions can't share the same one.
const isShortcuts = (v) => v && typeof v === 'object'
  && Object.keys(DEFAULT_SHORTCUTS).every((k) => isAccelerator(v[k]))
  && new Set(Object.keys(DEFAULT_SHORTCUTS).map((k) => v[k])).size === Object.keys(DEFAULT_SHORTCUTS).length;

// The values each setting accepts. Anything else is thrown away.
const SCHEMA = {
  language: (v) => LANGUAGES.includes(v),
  channel: (v) => typeof v === 'string' && /^[a-z0-9_]{0,25}$/.test(v),
  fontSize: inRange(10, 48),
  // Any installed font, but without characters that could break the CSS.
  fontFamily: (v) => typeof v === 'string' && /^[^"'\\;{}<>\u0000-\u001f]{1,64}$/.test(v),
  bold: isBool,
  textColor: isHex,
  userColors: isBool,
  bgColor: isHex,
  bgOpacity: inRange(0, 100),
  barColor: isHex,
  showViewers: isBool,
  outline: isBool,
  opacity: inRange(10, 100),
  maxMessages: inRange(3, 100),
  fadeAfter: inRange(0, 120),
  animatedEmotes: isBool,
  hideBots: isBool,
  highlightMentions: isBool,
  keywords: isText(300),
  highlightFirst: isBool,
  theme: (v) => ['', 'wow', 'lol', 'valorant', 'minecraft', 'cs2', 'overwatch', 'fortnite', 'rust'].includes(v),
  themeDecor: isBool,
  themeTag: isText(20),
  chatVisible: isBool,
  showRedemptions: isBool,
  showBadges: isBool,
  timestamps: isBool,
  mutedUsers: isText(1000),
  liveChannels: isText(2700), // 100 channels of up to 25 letters, separated by commas
  liveDuration: inRange(3, 30),
  liveSound: isBool,
  liveVolume: inRange(0, 100),
  alertBounds: (v) => v === null || (v && ['x', 'y'].every((k) => Number.isFinite(v[k]))
    && inRange(200, 4000)(v.width) && inRange(60, 2000)(v.height)),
  showDeleted: isBool,
  shortcuts: isShortcuts,
  align: (v) => v === 'left' || v === 'right',
  newestOnTop: isBool,
  idleHide: inRange(0, 300),
  emoteScale: inRange(1, 3),
  autoStart: isBool,
  activeProfile: isText(30),
  onboarded: isBool,
  lastVersion: isText(20),
  bounds: isBounds,
};

// Copies only the given keys of an object.
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));

// Returns only the valid settings of a patch. Lists (profiles, styles, chats) are cleaned item by item.
function sanitize(patch) {
  const clean = {};
  if (!patch || typeof patch !== 'object') return clean;
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'profiles') {
      if (Array.isArray(value)) clean.profiles = cleanProfiles(value);
    } else if (key === 'customStyles') {
      if (Array.isArray(value)) clean.customStyles = cleanStyles(value);
    } else if (key === 'extraChats') {
      if (Array.isArray(value)) clean.extraChats = cleanChats(value);
    } else if (key === 'shortcuts') {
      if (isShortcuts(value)) clean.shortcuts = pick(value, Object.keys(DEFAULT_SHORTCUTS));
    } else if (SCHEMA[key] && SCHEMA[key](value)) {
      clean[key] = value;
    }
  }
  return clean;
}

function cleanProfiles(list) {
  return list
    .filter((p) => p && isProfileName(p.name) && p.name.trim())
    .slice(0, PROFILES_MAX)
    .map((p) => ({ name: p.name.trim(), color: isHex(p.color) ? p.color : PROFILE_COLOR, data: pick(sanitize(p.data), PROFILE_KEYS) }));
}

// "My styles": looks saved by the user, with a name and a button color.
// Like the quick styles, they only keep the look, not the position or size.
const LOOK_KEYS = ['fontSize', 'fontFamily', 'bold', 'textColor', 'userColors', 'bgColor', 'bgOpacity', 'barColor', 'outline', 'opacity', 'emoteScale', 'theme', 'themeTag', 'themeDecor'];

function cleanStyles(list) {
  const seen = new Set();
  return list
    .filter((s) => s && isText(24)(s.name) && s.name.trim() && isHex(s.color) && s.data && typeof s.data === 'object')
    .map((s) => ({ name: s.name.trim(), color: s.color, data: pick(sanitize(s.data), LOOK_KEYS) }))
    // Names are unique without caring about upper or lower case.
    .filter((s) => !seen.has(s.name.toLowerCase()) && seen.add(s.name.toLowerCase()))
    .slice(0, STYLES_MAX);
}

function cleanChats(list) {
  const ids = new Set();
  return list
    .filter((c) => c && typeof c.id === 'string' && /^[a-z0-9]{1,16}$/.test(c.id)
      && typeof c.channel === 'string' && /^[a-z0-9_]{1,25}$/.test(c.channel))
    .filter((c) => !ids.has(c.id) && ids.add(c.id))
    .slice(0, EXTRA_CHATS_MAX)
    .map((c) => ({ id: c.id, channel: c.channel, visible: c.visible !== false, bounds: isBounds(c.bounds) ? c.bounds || null : null }));
}

module.exports = {
  DEFAULTS, PROFILE_KEYS, LOCAL_KEYS, PROFILES_MAX, PROFILE_COLOR, EXTRA_CHATS_MAX,
  isHex, isProfileName, pick, sanitize,
};
