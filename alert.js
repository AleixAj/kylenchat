// Recuadro de "Avisos de directo": una ventana aparte del chat, transparente y que deja pasar
// los clics. Solo existe mientras hay algo que enseñar: cuando se vacía, avisa al proceso
// principal y este la cierra para no gastar memoria.

const sound = document.getElementById('sound');
const grip = document.getElementById('grip');
const queue = [];
let settings = null;
let editing = false;
let current = null; // tarjeta que se está viendo
let currentInfo = null; // y sus datos, por si hay que volver a enseñarla
let hideTimer = null;
let received = 0; // avisos recibidos (el proceso principal lo compara antes de cerrar la ventana)

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
  setTimeout(() => { card.remove(); if (then) then(); }, 600); // lo que dura la animación de salida
}

function showNext() {
  if (current || editing) return;
  const info = queue.shift();
  if (!info) return maybeIdle();
  api.alertShow();
  playSound(); // suena con cada aviso que aparece
  present(makeCard(info));
  currentInfo = info;
  hideTimer = setTimeout(() => dismissCurrent(showNext), settings.liveDuration * 1000);
}

// Nada en pantalla, nada en cola y el sonido ya ha terminado: la ventana se puede cerrar.
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
    // Un aviso de ejemplo que se queda fijo mientras se mueve y se ajusta el recuadro.
    // Si se estaba viendo uno de verdad, vuelve a la cola y sale al fijar el recuadro.
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

api.onSettings((s) => { settings = s; });
api.onLiveAlert((info) => { if (settings) onAlert(info); });
api.onAlertEdit(setEditing);
api.getSettings().then((s) => {
  settings = s;
  api.alertReady(); // ya puede recibir avisos
});
