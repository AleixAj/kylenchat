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

function normalizeChannel(value) {
  return value.trim()
    .replace(/^https?:\/\/(www\.)?twitch\.tv\//i, '')
    .replace(/^#/, '')
    .split(/[/?]/)[0]
    .toLowerCase();
}

function connect() {
  const channel = normalizeChannel($('channel').value);
  $('channel').value = channel;
  api.setSettings({ channel });
}

function applyState({ editMode, visible, testMode, bounds, version, updateReady }) {
  $('test').textContent = testMode ? 'Salir del modo prueba' : 'Modo prueba (ver cómo queda)';
  $('test').classList.toggle('primary', testMode);
  $('version').textContent = `Versión ${version}`;
  $('update').classList.toggle('show', Boolean(updateReady));
  if (updateReady) $('updateText').textContent = `Nueva versión ${updateReady} lista para instalar.`;
  $('edit').textContent = editMode ? 'Fijar posición (Ctrl+Shift+L)' : 'Mover y cambiar tamaño (Ctrl+Shift+L)';
  $('visible').textContent = visible ? 'Ocultar chat (Ctrl+Shift+H)' : 'Mostrar chat (Ctrl+Shift+H)';
  $('width').value = bounds.width;
  $('height').value = bounds.height;
  $('widthVal').textContent = `${bounds.width} px`;
  $('heightVal').textContent = `${bounds.height} px`;
}

(async () => {
  const settings = await api.getSettings();
  $('channel').value = settings.channel;

  for (const [key, { type }] of Object.entries(FIELDS)) {
    const el = $(key);
    if (type === 'check') el.checked = settings[key];
    else el.value = settings[key];
    showValue(key);
    el.addEventListener('input', () => {
      showValue(key);
      api.setSettings({ [key]: readField(el, type) });
    });
  }

  applyState(await api.getState());
})();

$('installUpdate').addEventListener('click', () => api.installUpdate());
$('connect').addEventListener('click', connect);
$('channel').addEventListener('keydown', (e) => e.key === 'Enter' && connect());
$('edit').addEventListener('click', () => api.toggleEdit());
$('visible').addEventListener('click', () => api.toggleVisible());
$('test').addEventListener('click', () => api.toggleTest());
document.querySelectorAll('[data-pos]').forEach((b) => b.addEventListener('click', () => api.setPosition(b.dataset.pos)));

const sendSize = () => api.setSize(Number($('width').value), Number($('height').value));
$('width').addEventListener('input', sendSize);
$('height').addEventListener('input', sendSize);

api.onState(applyState);
