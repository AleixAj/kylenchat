// "Live alerts" box: a window apart from the chat, transparent, that lets clicks go through.
// It only exists while there is something to show: when it's empty it tells the main
// process, which closes it so it doesn't use memory.

const sound = document.getElementById('sound');
const queue = [];
let settings = null;
let editing = false;
let current = null; // card on screen right now
let currentInfo = null; // and its data, in case we need to show it again
let hideTimer = null;
let received = 0; // alerts received (the main process checks it before closing the window)

const tr = (key, vars) => i18n.t(settings ? settings.language : 'es', key, vars);

function makeCard({ name, title, game, logo }) {
  const card = document.createElement('div');
  card.className = 'card';
  const avatar = document.createElement('img');
  avatar.className = 'avatar';
  avatar.alt = '';
  avatar.src = logo || 'assets/icon.png';
  avatar.addEventListener('error', () => { avatar.src = 'assets/icon.png'; }, { once: true });
  const text = document.createElement('div');
  text.className = 'text';
  const tag = document.createElement('div');
  tag.className = 'tag';
  tag.textContent = tr('liveTag');
  const nameEl = document.createElement('div');
  nameEl.className = 'name';
  nameEl.textContent = name;
  const detail = document.createElement('div');
  detail.className = 'detail';
  detail.textContent = [title, game].filter(Boolean).join(' · ');
  text.append(tag, nameEl, detail);
  const progress = document.createElement('div');
  progress.className = 'progress';
  card.append(avatar, text, progress);
  return card;
}

function present(card) {
  current = card;
  card.style.setProperty('--duration', `${settings.liveDuration}s`);
  document.body.append(card);
  requestAnimationFrame(() => card.classList.add('show'));
}

function dismissCurrent(then) {
  clearTimeout(hideTimer);
  const card = current;
  current = null;
  currentInfo = null;
  if (!card) return then && then();
  card.classList.add('hide');
  setTimeout(() => { card.remove(); if (then) then(); }, 600); // how long the exit animation lasts
}

function showNext() {
  if (current || editing) return;
  const info = queue.shift();
  if (!info) return maybeIdle();
  api.alertShow();
  playSound(); // plays with each alert that appears
  present(makeCard(info));
  currentInfo = info;
  hideTimer = setTimeout(() => dismissCurrent(showNext), settings.liveDuration * 1000);
}

// Nothing on screen, nothing waiting and the sound has finished: the window can be closed.
function maybeIdle() {
  if (!current && !queue.length && !editing && sound.paused) api.alertIdle(received);
}

function playSound() {
  if (!settings.liveSound || settings.liveVolume <= 0) return;
  sound.volume = Math.min(1, settings.liveVolume / 100);
  sound.currentTime = 0;
  sound.play().catch(() => {});
}

function onAlert(info) {
  received++;
  queue.push(info);
  showNext();
}

function setEditing(on) {
  editing = on;
  document.body.classList.toggle('edit', on);
  if (on) {
    // A sample alert stays on screen while the box is moved and resized.
    // If a real one was showing, it goes back to the queue and shows when the box is locked.
    if (currentInfo) queue.unshift(currentInfo);
    dismissCurrent();
    for (const el of document.querySelectorAll('.card')) el.remove();
    api.alertShow();
    const sample = makeCard({ name: 'Kylen Chat', title: tr('liveTestTitle'), game: '', logo: '' });
    sample.classList.add('sample');
    present(sample);
  } else {
    dismissCurrent(showNext);
  }
}

sound.addEventListener('ended', maybeIdle);

setupResizeGrip(document.getElementById('grip'));

api.onSettings((s) => { settings = s; });
api.onLiveAlert((info) => { if (settings) onAlert(info); });
api.onAlertEdit(setEditing);
api.getSettings().then((s) => {
  settings = s;
  api.alertReady(); // it can receive alerts now
});
