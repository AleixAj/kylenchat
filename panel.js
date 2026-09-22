const $ = (id) => document.getElementById(id);

// Cada ajuste: tipo de control y cómo se muestra su valor.
const FIELDS = {
  fontSize: { type: 'range', show: (v) => `${v} px` },
  fontFamily: { type: 'select' },
  bold: { type: 'check' },
  textColor: { type: 'color' },
  userColors: { type: 'check' },
  outline: { type: 'check' },
  bgColor: { type: 'color' },
  bgOpacity: { type: 'range', show: (v) => `${v} %` },
  opacity: { type: 'range', show: (v) => `${v} %` },
  maxMessages: { type: 'range', show: (v) => String(v) },
  animatedEmotes: { type: 'check' },
  hideBots: { type: 'check' },
  autoStart: { type: 'check' },
  fadeAfter: { type: 'range', show: (v) => (Number(v) === 0 ? 'nunca' : `${v} s`) },
};

function readField(el, type) {
  if (type === 'check') return el.checked;
  if (type === 'range') return Number(el.value);
  return el.value;
}

function showValue(key) {
  const f = FIELDS[key];
  if (f.show) $(`${key}Val`).textContent = f.show($(key).value);
}

// Rellena los controles con los ajustes (al abrir y tras "Restablecer aspecto").
function fillFields(settings) {
  if (document.activeElement !== $('channel')) $('channel').value = settings.channel;
  for (const [key, { type }] of Object.entries(FIELDS)) {
    if (type === 'check') $(key).checked = settings[key];
    else $(key).value = settings[key];
    showValue(key);
  }
}

// Acepta "nombre", "#nombre" o el enlace completo de twitch.tv.
function normalizeChannel(value) {
  return value.trim()
    .replace(/^https?:\/\/(www\.|m\.)?twitch\.tv\//i, '')
    .replace(/^#/, '')
    .split(/[/?]/)[0]
    .toLowerCase();
}

function connect() {
  const channel = normalizeChannel($('channel').value);
  if (channel && !/^[a-z0-9_]{1,25}$/.test(channel)) {
    $('channelError').textContent = 'Nombre de canal no válido: solo letras, números y guion bajo.';
    return;
  }
  $('channelError').textContent = '';
  $('channel').value = channel;
  api.setSettings({ channel });
}

function applyState({ editMode, visible, testMode, bounds, maxSize, version, updateReady, shortcutErrors, canAutoStart }) {
  $('edit').textContent = editMode ? 'Fijar posición (Ctrl+Shift+L)' : 'Mover y cambiar tamaño (Ctrl+Shift+L)';
  $('visible').textContent = visible ? 'Ocultar chat (Ctrl+Shift+H)' : 'Mostrar chat (Ctrl+Shift+H)';
  $('test').textContent = testMode ? 'Salir del modo prueba' : 'Modo prueba (ver cómo queda)';
  $('test').classList.toggle('primary', testMode);

  $('width').max = maxSize.width;
  $('height').max = maxSize.height;
  $('width').value = bounds.width;
  $('height').value = bounds.height;
  $('widthVal').textContent = `${bounds.width} px`;
  $('heightVal').textContent = `${bounds.height} px`;

  $('version').textContent = `v${version}`;
  $('update').classList.toggle('show', Boolean(updateReady));
  if (updateReady) $('updateText').textContent = `Nueva versión ${updateReady} lista para instalar.`;

  $('shortcutWarn').textContent = shortcutErrors.length
    ? `Otro programa ya usa ${shortcutErrors.join(' y ')}. Ese atajo no funcionará; usa los botones de esta ventana o el icono de la bandeja.`
    : '';
  $('startupSection').hidden = !canAutoStart; // solo tiene sentido en la versión instalada
}

for (const [key, { type }] of Object.entries(FIELDS)) {
  const el = $(key);
  el.addEventListener('input', () => {
    showValue(key);
    api.setSettings({ [key]: readField(el, type) });
  });
}

$('connect').addEventListener('click', connect);
$('channel').addEventListener('keydown', (e) => e.key === 'Enter' && connect());
$('installUpdate').addEventListener('click', () => api.installUpdate());
$('edit').addEventListener('click', () => api.toggleEdit());
$('visible').addEventListener('click', () => api.toggleVisible());
$('test').addEventListener('click', () => api.toggleTest());
$('reset').addEventListener('click', () => api.resetLook());
$('repo').addEventListener('click', () => api.openRepo());
document.querySelectorAll('[data-pos]').forEach((b) => b.addEventListener('click', () => api.setPosition(b.dataset.pos)));

const sendSize = () => api.setSize(Number($('width').value), Number($('height').value));
$('width').addEventListener('input', sendSize);
$('height').addEventListener('input', sendSize);

api.onSettings(fillFields);
api.onState(applyState);
api.getSettings().then(fillFields);
api.getState().then(applyState);
