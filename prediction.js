// "Prediction" and "poll" boxes: windows apart from the chat, transparent, that let clicks go through.
// Each one shows the prediction or the poll of the main chat's channel with the votes as they
// come in, and the result for a few seconds at the end. When it's empty it tells the main
// process, which closes it. The same file is used for both (?kind=poll in the address).

const IS_POLL = new URLSearchParams(location.search).get('kind') === 'poll';

// Games whose look the box can copy (the same ones as the chat, themes.css).
const GAME_STYLES = ['wow', 'lol', 'valorant', 'minecraft', 'cs2', 'overwatch', 'fortnite', 'rust'];

let settings = null;
let editing = false;
let current = null; // the real prediction or poll (also kept while editing, to show it afterwards)
let card = null; // box on screen right now
let shown = null; // and what it shows
let hideTimer = null;
let testTimer = null;

const tr = (key, vars) => i18n.t(settings ? settings.language : 'es', key, vars);
const isOver = (p) => p.status === 'RESOLVED' || p.status === 'CANCELED';
let accent = '#a970ff';
let ownBars = null; // answer colors picked by the user (null: they come from the accent)

// ---------- Look ----------
// By default the box follows the chat: its bar color, font, text color and game style.
// If the user turns that off, it uses its own colors with a neutral font. Opacity and effects always apply.
function applyLook(s) {
  const match = s.predictionMatchChat;
  const theme = match && GAME_STYLES.includes(s.theme) ? s.theme : '';
  accent = match ? s.barColor : s.predictionColor;
  // Predictions: 2 colors (more answers get automatic ones). Polls: one for each of their 5 answers.
  ownBars = match ? null : IS_POLL ? [1, 2, 3, 4, 5].map((i) => s[`pollBar${i}`]) : [s.predictionBar1, s.predictionBar2];
  const root = document.documentElement.style;
  root.setProperty('--accent', accent);
  root.setProperty('--accent-text', readable(accent));
  root.setProperty('--base', match ? s.bgColor : s.predictionBgColor);
  root.setProperty('--text', match ? s.textColor : s.predictionTextColor);
  root.setProperty('--box-opacity', String(s.predictionOpacity / 100));
  root.setProperty('--bg', String(s.predictionBgOpacity));
  document.body.classList.toggle('no-fx', !s.predictionEffects);
  root.setProperty('--ff', `"${match ? s.fontFamily : 'Exo 2'}"`);
  root.setProperty('--hud', theme === 'minecraft' ? '"Monocraft"' : '"Rajdhani"');
  for (const t of GAME_STYLES) document.body.classList.toggle(`theme-${t}`, t === theme);
  if (card) {
    paintOutcomes(card, shown.outcomes.length);
    fit();
  }
}

function hexToHsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return [0, 0, l];
  const sat = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, sat, l];
}

// One color per answer, all from the accent: the first is the accent and the rest spread around
// the color wheel (2 answers: the opposite color, like red against teal). If the accent is
// almost grey (white, black...), it starts from blue so the answers can be told apart.
// With its own colors, the answers use the ones the user picked.
function outcomeColors(n) {
  let [h, sat, l] = hexToHsl(accent);
  if (sat < 0.2) [h, sat, l] = [220, 0.85, 0.6];
  sat = Math.max(sat, 0.7);
  l = Math.min(Math.max(l, 0.5), 0.65);
  return Array.from({ length: n }, (_, i) => {
    if (ownBars && i < ownBars.length) return ownBars[i];
    if (!ownBars && i === 0 && hexToHsl(accent)[1] >= 0.2) return accent;
    return `hsl(${Math.round((h + (i * 360) / n) % 360)} ${Math.round(sat * 100)}% ${Math.round(l * 100)}%)`;
  });
}

function paintOutcomes(c, n) {
  const colors = outcomeColors(n);
  c.querySelectorAll('.outcome').forEach((row, i) => row.style.setProperty('--c', colors[i]));
}
const compact = (n) => new Intl.NumberFormat(settings.language, { notation: 'compact', maximumFractionDigits: 1 }).format(n);

function el(className, parent) {
  const e = document.createElement('div');
  e.className = className;
  if (parent) parent.append(e);
  return e;
}

function makeCard(p) {
  const c = el('card');
  const inner = el('inner', c);
  el('scan', inner);
  const head = el('head', inner);
  el('tag', head).textContent = tr(IS_POLL ? 'pollTag' : 'predictionTag');
  el('status', head);
  el('title', inner).textContent = p.title;
  const list = el('outcomes', inner);
  p.outcomes.forEach((o) => {
    const row = el('outcome', list);
    const bar = el('bar', row);
    el('fill', bar);
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = o.title;
    const pct = document.createElement('span');
    pct.className = 'pct';
    bar.append(name, pct);
    el('stats', row);
  });
  el('time', inner);
  paintOutcomes(c, p.outcomes.length);
  return c;
}

// Writes the numbers in the box (the bars move to their new size).
// In a poll "points" are the votes, and every answer tied at the top wins.
function update(c, p) {
  const total = p.outcomes.reduce((sum, o) => sum + o.points, 0);
  const top = Math.max(...p.outcomes.map((o) => o.points));
  const wins = (o) => p.status === 'RESOLVED' && (IS_POLL ? top > 0 && o.points === top : o.id === p.winner);
  c.classList.remove('ACTIVE', 'LOCKED', 'RESOLVED', 'CANCELED', 'done');
  c.classList.add(p.status);
  if (p.status === 'RESOLVED') c.classList.add('done');
  c.querySelector('.title').textContent = p.title;
  c.querySelectorAll('.outcome').forEach((row, i) => {
    const o = p.outcomes[i];
    if (!o) return;
    const pct = total ? Math.round((o.points / total) * 100) : 0;
    row.classList.toggle('win', wins(o));
    row.querySelector('.fill').style.width = `${pct}%`;
    row.querySelector('.pct').textContent = `${pct}%`;
    row.querySelector('.stats').textContent = IS_POLL
      ? tr('pollStats', { votes: compact(o.points), users: compact(o.users) })
      : tr('predictionStats', { points: compact(o.points), users: compact(o.users) });
  });
  tick();
  fit();
}

// Countdown while people can vote, and the state after that.
function tick() {
  if (!card || !shown) return;
  const p = shown;
  const status = card.querySelector('.status');
  let text;
  let urgent = false;
  if (p.status === 'ACTIVE') {
    const left = Math.max(0, p.createdAt + p.windowSeconds * 1000 - Date.now());
    const s = Math.ceil(left / 1000);
    urgent = left > 0 && s <= 10;
    text = left > 0 ? tr('predictionLeft', { time: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }) : tr('predictionClosing');
    card.querySelector('.time').style.transform = `scaleX(${p.windowSeconds ? left / (p.windowSeconds * 1000) : 0})`;
  } else if (p.status === 'LOCKED') {
    text = tr('predictionLocked');
  } else if (p.status === 'RESOLVED') {
    text = tr(IS_POLL ? 'pollResolved' : 'predictionResolved');
  } else {
    text = tr('predictionCanceled');
  }
  status.textContent = text;
  status.classList.toggle('urgent', urgent && !editing);
}
setInterval(tick, 250);

// Picks the biggest font size at which the whole box fits in the window.
function fit() {
  if (!card) return;
  let lo = 8;
  let hi = 48;
  while (hi - lo > 0.5) {
    const mid = (lo + hi) / 2;
    document.body.style.fontSize = `${mid}px`;
    const fits = card.scrollHeight <= innerHeight - 8 && card.scrollWidth <= innerWidth - 8;
    if (fits) lo = mid;
    else hi = mid;
  }
  // No wider than a line of about 20 letters per window width, so it doesn't look huge in a wide box.
  document.body.style.fontSize = `${Math.min(lo, innerWidth / 17)}px`;
}
addEventListener('resize', fit);

function show(p) {
  clearTimeout(hideTimer);
  if (!card || !shown || shown.id !== p.id || shown.outcomes.length !== p.outcomes.length) {
    removeCard();
    card = makeCard(p);
    document.getElementById('stage').append(card);
    api.voteShow();
    requestAnimationFrame(() => card && card.classList.add('show'));
  }
  shown = p;
  update(card, p);
}

function removeCard() {
  for (const c of document.querySelectorAll('.card')) c.remove();
  card = null;
  shown = null;
}

// The box goes away with its animation; then, if nothing else is coming, the window closes.
function dismiss() {
  clearTimeout(hideTimer);
  const c = card;
  card = null;
  shown = null;
  if (!c) return maybeIdle();
  c.classList.add('hide');
  setTimeout(() => { c.remove(); maybeIdle(); }, 500); // how long the exit animation lasts
}

function maybeIdle() {
  if (!card && !editing && !testTimer) api.voteIdle();
}

// The real prediction or poll changed (null: there's none anymore).
function onVote(p) {
  stopTest();
  current = p;
  if (editing) return; // it shows when the box is locked
  if (!p) return dismiss();
  show(p);
  if (isOver(p)) hideTimer = setTimeout(dismiss, settings.predictionResultTime * 1000);
}

function sample() {
  if (IS_POLL) {
    return {
      id: 'sample',
      title: tr('pollSampleTitle'),
      status: 'ACTIVE',
      createdAt: Date.now(),
      windowSeconds: 120,
      winner: '',
      outcomes: tr('pollSampleChoices').split('|').map((title, i) => ({ id: String(i), title, points: [54, 31, 22, 9][i], users: [54, 31, 22, 9][i] })),
    };
  }
  return {
    id: 'sample',
    title: tr('predictionSampleTitle'),
    status: 'ACTIVE',
    createdAt: Date.now(),
    windowSeconds: 120,
    winner: '',
    outcomes: [
      { id: 'a', title: tr('predictionSampleYes'), points: 48200, users: 37 },
      { id: 'b', title: tr('predictionSampleNo'), points: 31500, users: 52 },
    ],
  };
}

// "Test": a sample that plays out in about 20 seconds (votes, close, result). Polls don't lock.
function runTest() {
  if (editing) return;
  stopTest();
  const p = { ...sample(), windowSeconds: 18 };
  p.outcomes = p.outcomes.map((o) => ({ ...o, points: 0, users: 0 }));
  let step = 0;
  show(p);
  testTimer = setInterval(() => {
    step++;
    const next = { ...p, outcomes: shown ? shown.outcomes.map((o) => ({ ...o })) : p.outcomes };
    if (step < 18) {
      for (const o of next.outcomes) {
        const votes = Math.floor(Math.random() * 4);
        o.users += votes;
        o.points += IS_POLL ? votes : votes * (100 + Math.floor(Math.random() * 2400));
      }
    } else if (step < 21 && !IS_POLL) {
      next.status = 'LOCKED';
    } else {
      next.status = 'RESOLVED';
      next.winner = next.outcomes.reduce((a, b) => (b.points > a.points ? b : a)).id;
      clearInterval(testTimer);
      testTimer = null;
      hideTimer = setTimeout(dismiss, settings.predictionResultTime * 1000);
    }
    show(next);
  }, 1000);
}

function stopTest() {
  if (!testTimer) return;
  clearInterval(testTimer);
  testTimer = null;
  removeCard();
}

function setEditing(on) {
  editing = on;
  document.body.classList.toggle('edit', on);
  stopTest();
  clearTimeout(hideTimer);
  removeCard();
  if (on) {
    // A sample stays on screen while the box is moved and resized.
    show(sample());
  } else if (current) {
    onVote(current);
  } else {
    maybeIdle();
  }
}

setupResizeGrip(document.getElementById('grip'));

api.onSettings((s) => {
  settings = s;
  applyLook(s);
});
api.onVote((p) => { if (settings) onVote(p); });
api.onVoteEdit(setEditing);
api.onVoteTest(runTest);
api.getSettings().then((s) => {
  settings = s;
  applyLook(s);
  api.voteReady(); // it can receive predictions or polls now
});
