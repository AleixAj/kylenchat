// Estilos de juegos: datos que comparten el chat (overlay.js) y la vista previa del panel (panel.js).
// El aspecto de cada uno está en themes.css. Inspirados en World of Warcraft, League of Legends,
// Valorant y Minecraft; no están afiliados a Blizzard, Riot Games ni Mojang.
(function (root) {
  const GAME_THEMES = {
    wow: {
      // Aspecto al elegirlo (se puede cambiar después en el panel)
      look: { fontFamily: 'Arial Narrow', fontSize: 15, bold: false, textColor: '#FFC0C0', bgColor: '#000000', bgOpacity: 30, outline: false, barColor: '#FFD100', emoteScale: 1.4 },
      // Colores de clase
      names: ['#C69B6D', '#F48CBA', '#AAD372', '#FFF468', '#FFFFFF', '#C41E3A', '#0070DD', '#3FC7EB', '#8788EE', '#00FF98', '#FF7C0A', '#A330C9', '#33937F'],
      // Streamer y moderadores con los colores de rareza: legendario y épico
      roles: { broadcaster: '#FF8000', moderator: '#A335EE' },
    },
    lol: {
      look: { fontFamily: 'Inter', fontSize: 14, bold: false, textColor: '#F0E6D2', bgColor: '#0B0F14', bgOpacity: 55, outline: false, barColor: '#C8AA6E', emoteScale: 1.4 },
      names: ['#5AAFF0', '#E8584A'], // aliados y enemigos
      roles: { broadcaster: '#EBA03B', moderator: '#5AAFF0' },
    },
    valorant: {
      look: { fontFamily: 'D-DIN', fontSize: 15, bold: false, textColor: '#ECE8E1', bgColor: '#0F1923', bgOpacity: 65, outline: false, barColor: '#FF4655', emoteScale: 1.4 },
      names: ['#5AD4C4', '#FF4655'], // aliados y enemigos
      roles: { broadcaster: '#F2C94C', moderator: '#B9A0FF' },
    },
    minecraft: {
      look: { fontFamily: 'Monocraft', fontSize: 14, bold: false, textColor: '#FFFFFF', bgColor: '#000000', bgOpacity: 50, outline: false, barColor: '#FFFF55', emoteScale: 1.3 },
      names: ['#FFFFFF'], // en Minecraft los nombres van en blanco
      roles: { broadcaster: '#FFAA00', moderator: '#55FFFF' },
    },
    cs2: {
      look: { fontFamily: 'Rajdhani', fontSize: 16, bold: false, textColor: '#FFFFFF', bgColor: '#000000', bgOpacity: 55, outline: false, barColor: '#E8B84A', emoteScale: 1.4 },
      names: ['#5EA8FF', '#EAC05A'], // antiterroristas y terroristas
      roles: { broadcaster: '#E8B84A', moderator: '#B18CFF' },
    },
    overwatch: {
      look: { fontFamily: 'Jost', fontSize: 15, bold: false, textColor: '#F4A052', bgColor: '#0B1130', bgOpacity: 82, outline: false, barColor: '#F99E1A', emoteScale: 1.4 },
      names: ['#F4A052'], // en el chat de partida, el nombre va en el mismo naranja
      roles: { broadcaster: '#FFD166', moderator: '#45A9FF' }, // los mods, en el azul del chat de equipo
    },
    fortnite: {
      look: { fontFamily: 'Inter', fontSize: 15, bold: false, textColor: '#FFFFFF', bgColor: '#1E2230', bgOpacity: 78, outline: false, barColor: '#E8EAF0', emoteScale: 1.4 },
      names: ['#FFFFFF'],
      roles: { broadcaster: '#FFD84A', moderator: '#62D4FF' },
    },
    rust: {
      look: { fontFamily: 'Roboto Condensed', fontSize: 16, bold: true, textColor: '#FFFFFF', bgColor: '#000000', bgOpacity: 0, outline: false, barColor: '#A9D16D', emoteScale: 1.4 },
      names: ['#6CB4FF'], // chat global
      roles: { broadcaster: '#AAFF55', moderator: '#FFC857' }, // el streamer, en el verde de los admins
    },
  };

  // Colores de los avatares con la inicial (Fortnite); en Rust van en negro como los de Steam sin foto.
  const AVATAR_COLORS = ['#E8505B', '#F29E4C', '#EFD65F', '#58C08E', '#3FA7D6', '#7B68EE', '#D96AC6', '#4DD0C8'];
  const AVATAR_THEMES = new Set(['fortnite', 'rust']);

  function hashIndex(text, n) {
    let h = 0;
    for (const ch of String(text)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return h % n;
  }

  // Color del nombre en un estilo de juego: el del papel (streamer, mod) o uno fijo por usuario.
  function nameColor(theme, user, roles) {
    const t = GAME_THEMES[theme];
    if (!t) return '';
    if (roles.has('broadcaster')) return t.roles.broadcaster;
    if (roles.has('moderator')) return t.roles.moderator;
    return t.names[hashIndex(user, t.names.length)];
  }

  // El papel más alto de quien escribe, según sus insignias de Twitch.
  function roleOf(roles) {
    for (const role of ['broadcaster', 'moderator', 'vip', 'subscriber']) if (roles.has(role)) return role;
    return 'user';
  }

  // Estilos en los que la etiqueta del canal es el papel de quien escribe (como los canales de
  // WoW: [Hermandad], [Grupo]...). La línea mantiene su color; solo el nombre va coloreado.
  const ROLE_TAG_THEMES = new Set(['wow']);

  // Estilos en los que cada línea empieza con la hora (como el reloj de partida de LoL).
  const TIME_THEMES = new Set(['lol']);
  // Estilos en los que la etiqueta del canal va del mismo color que el nombre ("[Team] Nombre").
  const TAG_LIKE_NAME_THEMES = new Set(['lol', 'rust']);
  // Estilos que ponen el papel como rango delante del nombre ("[VIP] <Nombre>" en Minecraft,
  // "[Mod] Nombre" como etiqueta de clan en Rust). Solo si tiene papel: sin "[Usuario]" en cada línea.
  const RANK_THEMES = new Set(['minecraft', 'rust']);
  // (LoL y Valorant lo ponen donde va el campeón o agente, y CS2 donde va la ubicación: eso va en themes.css)

  // Iconos de los botones decorativos de WoW, dibujados para la app (no son los del juego).
  const ICONS = {
    friends: '<svg viewBox="0 0 16 16"><circle cx="8" cy="4.8" r="3.2"/><path d="M1.8 15.2c0-3.6 2.8-6 6.2-6s6.2 2.4 6.2 6z"/></svg>',
    speaker: '<svg viewBox="0 0 16 16"><path d="M1.5 5.8h3l4.2-3.3v11L4.5 10.2h-3z"/><path d="M10.8 5.4a3.6 3.6 0 0 1 0 5.2M12.7 3.6a6.2 6.2 0 0 1 0 8.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    bubble: '<svg viewBox="0 0 16 16"><path d="M1.5 3h13v8H7.2l-3.7 3v-3h-2z"/></svg>',
  };

  // Detalles decorativos de cada juego: botones de WoW, casillas de escribir de LoL, Valorant y
  // Minecraft, barra de desplazamiento de Valorant. No se pueden pulsar (la capa no recibe clics).
  function buildDecor(el, theme, tag, t) {
    el.replaceChildren();
    const add = (className, parent = el) => {
      const d = document.createElement('div');
      d.className = className;
      parent.append(d);
      return d;
    };
    const label = (parent, text) => {
      const s = document.createElement('span');
      s.className = 'input-tag';
      s.textContent = text;
      parent.append(s);
    };
    if (theme === 'wow') {
      const column = add('wow-buttons');
      const friends = add('wow-btn friends', column);
      friends.innerHTML = ICONS.friends; // iconos fijos de la app
      const count = document.createElement('b');
      count.className = 'wow-count';
      friends.append(count);
      add('wow-btn speaker', column).innerHTML = ICONS.speaker;
      add('wow-btn bubble', column).innerHTML = ICONS.bubble;
    } else if (theme === 'lol') {
      label(add('game-input lol-input'), `[${tag}]`);
    } else if (theme === 'valorant') {
      add('val-scroll');
      label(add('game-input val-input'), `${tag}:`);
    } else if (theme === 'minecraft') {
      add('game-input mc-input').textContent = '_';
    } else if (theme === 'cs2') {
      const input = add('game-input cs2-input');
      label(input, t('cs2Say'));
      const send = document.createElement('b');
      send.className = 'send';
      send.textContent = t('cs2Send');
      input.append(send);
    } else if (theme === 'overwatch') {
      add('ow-scroll');
      const input = add('game-input ow-input');
      label(input, `◆ [${tag}]:`);
      const hint = document.createElement('span');
      hint.className = 'hint';
      hint.textContent = t('owHint');
      input.append(hint);
    } else if (theme === 'fortnite') {
      const input = add('game-input fn-input');
      add('fn-field', input).textContent = t('fnHint');
      add('fn-more', input).textContent = '•••';
    } else if (theme === 'rust') {
      const input = add('game-input rust-input');
      label(input, `[${tag}]`);
      add('rust-caret', input);
      add('rust-person', input).innerHTML = ICONS.friends;
    }
  }

  // Avatar con la inicial de quien escribe (Fortnite: redondo y de color; Rust: cuadrado y negro).
  function makeAvatar(theme, name) {
    if (!AVATAR_THEMES.has(theme)) return null;
    const a = document.createElement('span');
    a.className = 'avatar';
    const letters = Array.from(String(name).replace(/^[^\p{L}\p{N}]+/u, ''));
    a.textContent = (letters[0] || '?').toUpperCase();
    if (theme === 'fortnite') a.style.backgroundColor = AVATAR_COLORS[hashIndex(String(name).toLowerCase(), AVATAR_COLORS.length)];
    return a;
  }

  root.GameThemes = { THEMES: Object.keys(GAME_THEMES), GAME_THEMES, nameColor, roleOf, ROLE_TAG_THEMES, TIME_THEMES, TAG_LIKE_NAME_THEMES, RANK_THEMES, buildDecor, makeAvatar };
})(typeof window !== 'undefined' ? window : globalThis);
