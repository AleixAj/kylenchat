// Game styles: data shared by the chat (overlay.js) and the preview in the settings window (panel.js).
// The look of each one is in themes.css. They are inspired by World of Warcraft, League of Legends,
// Valorant, Minecraft, Counter-Strike 2, Overwatch 2, Fortnite and Rust, and not affiliated with their makers.
(function (root) {
  // Look applied when the style is picked (it can be changed later in the settings window).
  const GAME_THEMES = {
    wow: {
      look: { fontFamily: 'Arial Narrow', fontSize: 15, bold: false, textColor: '#FFC0C0', bgColor: '#000000', bgOpacity: 10, outline: false, barColor: '#FFD100', emoteScale: 1.4 },
    },
    lol: {
      look: { fontFamily: 'Inter', fontSize: 14, bold: false, textColor: '#F0E6D2', bgColor: '#0B0F14', bgOpacity: 35, outline: false, barColor: '#C8AA6E', emoteScale: 1.4 },
    },
    valorant: {
      look: { fontFamily: 'D-DIN', fontSize: 15, bold: false, textColor: '#ECE8E1', bgColor: '#0F1923', bgOpacity: 10, outline: false, barColor: '#FF4655', emoteScale: 1.4 },
    },
    minecraft: {
      look: { fontFamily: 'Monocraft', fontSize: 14, bold: false, textColor: '#FFFFFF', bgColor: '#000000', bgOpacity: 35, outline: false, barColor: '#FFFF55', emoteScale: 1.3 },
    },
    cs2: {
      look: { fontFamily: 'Rajdhani', fontSize: 16, bold: false, textColor: '#FFFFFF', bgColor: '#000000', bgOpacity: 10, outline: false, barColor: '#E8B84A', emoteScale: 1.4 },
    },
    overwatch: {
      look: { fontFamily: 'Jost', fontSize: 15, bold: false, textColor: '#F4A052', bgColor: '#0B1130', bgOpacity: 10, outline: false, barColor: '#F99E1A', emoteScale: 1.4 },
    },
    fortnite: {
      look: { fontFamily: 'Inter', fontSize: 15, bold: false, textColor: '#FFFFFF', bgColor: '#1E2230', bgOpacity: 10, outline: false, barColor: '#E8EAF0', emoteScale: 1.4 },
    },
    rust: {
      look: { fontFamily: 'Roboto Condensed', fontSize: 16, bold: true, textColor: '#FFFFFF', bgColor: '#000000', bgOpacity: 0, outline: false, barColor: '#A9D16D', emoteScale: 1.4 },
    },
  };

  // Colors of the avatars with the first letter (Fortnite); in Rust they are black like Steam ones without a picture.
  const AVATAR_COLORS = ['#E8505B', '#F29E4C', '#EFD65F', '#58C08E', '#3FA7D6', '#7B68EE', '#D96AC6', '#4DD0C8'];
  const AVATAR_THEMES = new Set(['fortnite', 'rust']);

  // Badges of the cards in the settings window: each game's logo (assets/games) on its color.
  // The logos are trademarks of their owners; the SVGs come from Simple Icons (CC0) and Wikimedia Commons.
  // WoW has no reliable free logo, so it gets a "W" in its gold color.
  const BADGES = {
    wow: { text: 'W', font: '400 17px "Marcellus", serif', color: '#FFD100', bg: 'linear-gradient(160deg, #5c2412, #1e0d06)', border: '#A0582A' },
    lol: { img: 'leagueoflegends', bg: 'linear-gradient(160deg, #0a1a2a, #010a13)', border: '#785A28' },
    valorant: { img: 'valorant', bg: '#FF4655', border: '#FF4655' },
    minecraft: { img: 'minecraft', bg: '#1E1E1E', border: '#3C8527' },
    cs2: { img: 'counterstrike', bg: '#0C0F12', border: '#3a3a3a' },
    overwatch: { img: 'overwatch', bg: '#FFFFFF', border: '#FFFFFF' },
    fortnite: { img: 'fortnite', bg: 'linear-gradient(135deg, #7B3FF2, #29A8FF)', border: '#7B3FF2' },
    rust: { img: 'rust', bg: '#1C1C1C', border: '#CD412B', wide: true },
  };

  function makeBadge(theme) {
    const b = BADGES[theme];
    const el = document.createElement('span');
    el.className = 'game-badge';
    if (!b) return el;
    if (b.wide) el.classList.add('wide');
    el.style.background = b.bg;
    el.style.borderColor = b.border;
    if (b.img) {
      const img = document.createElement('img');
      img.src = `assets/games/${b.img}.svg`;
      img.alt = '';
      el.append(img);
    } else {
      el.textContent = b.text;
      el.style.font = b.font;
      el.style.color = b.color;
    }
    return el;
  }

  // Turns a text into a number from 0 to n-1, always the same for the same text.
  function hashIndex(text, n) {
    let h = 0;
    for (const ch of String(text)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return h % n;
  }

  // Names always use each user's Twitch color. For people who never picked one (and for the
  // sample users), a fixed color from this list, chosen by the name.
  const TWITCH_COLORS = ['#FF4A80', '#FF7070', '#FA8E4B', '#FEE440', '#5FFF77', '#00F5D4', '#00BBF9', '#4371FB', '#9B5DE5', '#F670DD'];
  function colorFor(name) {
    let h = 0;
    for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) | 0;
    return TWITCH_COLORS[Math.abs(h) % TWITCH_COLORS.length];
  }

  // The highest role of who writes, from their Twitch badges.
  function roleOf(roles) {
    for (const role of ['broadcaster', 'moderator', 'vip', 'subscriber']) if (roles.has(role)) return role;
    return 'user';
  }

  // Styles where the channel tag is the role of who writes (like WoW chat channels:
  // [Guild], [Party]...). The line keeps its color; only the name is colored.
  const ROLE_TAG_THEMES = new Set(['wow']);
  // Styles where each line starts with the time (like the match clock in LoL).
  const TIME_THEMES = new Set(['lol']);
  // Styles that show the role as a rank before the name ("[VIP] <Name>" in Minecraft,
  // "[Mod] Name" like a clan tag in Rust). Only if they have a role: no "[User]" on every line.
  const RANK_THEMES = new Set(['minecraft', 'rust']);
  // (LoL and Valorant show it where the champion or agent goes, and CS2 where the location goes: that's in themes.css)

  // Icons of the WoW decorative buttons, drawn for the app (they are not the game's).
  const ICONS = {
    friends: '<svg viewBox="0 0 16 16"><circle cx="8" cy="4.8" r="3.2"/><path d="M1.8 15.2c0-3.6 2.8-6 6.2-6s6.2 2.4 6.2 6z"/></svg>',
    speaker: '<svg viewBox="0 0 16 16"><path d="M1.5 5.8h3l4.2-3.3v11L4.5 10.2h-3z"/><path d="M10.8 5.4a3.6 3.6 0 0 1 0 5.2M12.7 3.6a6.2 6.2 0 0 1 0 8.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    bubble: '<svg viewBox="0 0 16 16"><path d="M1.5 3h13v8H7.2l-3.7 3v-3h-2z"/></svg>',
    up: '<svg viewBox="0 0 16 16"><path d="M8 3.5l5.5 7h-11z"/></svg>',
    down: '<svg viewBox="0 0 16 16"><path d="M8 12.5l5.5-7h-11z"/></svg>',
    bottom: '<svg viewBox="0 0 16 16"><path d="M8 10.5l5.5-7h-11z"/><rect x="2.5" y="12" width="11" height="2"/></svg>',
  };
  // In WoW each role is a numbered channel, like "[1. General]" or "[2. Trade]".
  const WOW_CHANNEL_NUMBER = { user: 1, subscriber: 2, vip: 3, moderator: 4, broadcaster: 5 };

  // Decorative details of each game: WoW buttons and the Valorant and Overwatch scroll bars.
  // They can't be clicked (the layer lets clicks through).
  function buildDecor(el, theme) {
    el.replaceChildren();
    const add = (className, parent = el) => {
      const d = document.createElement('div');
      d.className = className;
      parent.append(d);
      return d;
    };
    if (theme === 'wow') {
      const column = add('wow-buttons');
      // fixed app icons, no outside data
      add('wow-btn friends', column).innerHTML = ICONS.friends;
      add('wow-btn speaker', column).innerHTML = ICONS.speaker;
      add('wow-btn bubble', column).innerHTML = ICONS.bubble;
      // At the bottom, the scroll ones: up, down and go to the end
      add('wow-btn scroll-up', column).innerHTML = ICONS.up;
      add('wow-btn scroll-down', column).innerHTML = ICONS.down;
      add('wow-btn scroll-end', column).innerHTML = ICONS.bottom;
    } else if (theme === 'valorant') {
      add('val-scroll');
    } else if (theme === 'overwatch') {
      add('ow-scroll');
    }
  }

  // Twitch default pictures (colored silhouettes) for the made up users of test mode
  // and of the preview: always the same one for each name.
  const SAMPLE_PICTURES = [
    '215b7342-def9-11e9-9a66-784f43822e80', 'ce57700a-def9-11e9-842d-784f43822e80', 'ebe4cd89-b4f4-4cd9-adac-2f30151b4209',
    '75305d54-c7cc-40d1-bb9c-91fbe85943c7', '294c98b5-e34d-42cd-a8f0-140b72fba9b0', '998f01ae-def8-11e9-b95c-784f43822e80',
  ].map((id) => `https://static-cdn.jtvnw.net/user-default-pictures-uv/${id}-profile_image-70x70.png`);

  function samplePicture(name) {
    return SAMPLE_PICTURES[hashIndex(String(name).toLowerCase(), SAMPLE_PICTURES.length)];
  }

  // Avatar with the first letter of who writes (Fortnite: round and colored; Rust: square and black).
  function makeAvatar(theme, name) {
    if (!AVATAR_THEMES.has(theme)) return null;
    const a = document.createElement('span');
    a.className = 'avatar';
    const letters = Array.from(String(name).replace(/^[^\p{L}\p{N}]+/u, ''));
    a.textContent = (letters[0] || '?').toUpperCase();
    if (theme === 'fortnite') a.style.backgroundColor = AVATAR_COLORS[hashIndex(String(name).toLowerCase(), AVATAR_COLORS.length)];
    return a;
  }

  root.GameThemes = { THEMES: Object.keys(GAME_THEMES), GAME_THEMES, colorFor, roleOf, ROLE_TAG_THEMES, TIME_THEMES, RANK_THEMES, WOW_CHANNEL_NUMBER, buildDecor, makeAvatar, makeBadge, samplePicture };
})(typeof window !== 'undefined' ? window : globalThis);
