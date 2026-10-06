// 7TV paints: user names drawn with a gradient or an image.
// Twitch doesn't send these colors, they come from 7TV. Its event socket tells us, for the
// channel we are in, which paint each person wears ("entitlement") and what each paint looks
// like ("cosmetic"). We keep everything in memory and use it when a name is drawn.

const paintCss = new Map();  // paint id -> CSS styles
const userPaint = new Map(); // Twitch user id -> paint id
let paintSocket = null;
let paintRoom = null;
let paintRetry = 0;
let paintTimer = null;

// 7TV stores colors as a 32-bit RGBA number.
function rgba(n) {
  const c = n >>> 0;
  return `rgba(${(c >>> 24) & 255}, ${(c >>> 16) & 255}, ${(c >>> 8) & 255}, ${((c & 255) / 255).toFixed(3)})`;
}

function paintToCss(p) {
  const stops = (p.stops || []).map((s) => `${rgba(s.color)} ${Math.round(s.at * 1000) / 10}%`).join(', ');
  const rep = p.repeat ? 'repeating-' : '';
  let image = null;
  if (p.function === 'LINEAR_GRADIENT' && stops) image = `${rep}linear-gradient(${Number(p.angle) || 0}deg, ${stops})`;
  else if (p.function === 'RADIAL_GRADIENT' && stops) image = `${rep}radial-gradient(${p.shape === 'ellipse' ? 'ellipse' : 'circle'}, ${stops})`;
  else if (p.function === 'URL' && /^https:\/\/cdn\.7tv\.app\//.test(p.image_url || '')) image = `url("${p.image_url}")`;
  if (!image) return null;
  const shadows = (p.shadows || []).slice(0, 4)
    .map((s) => `drop-shadow(${s.x_offset}px ${s.y_offset}px ${s.radius}px ${rgba(s.color)})`).join(' ');
  return { image, shadows, url: p.function === 'URL' };
}

// Puts the paint on the name if the user has one; if not, the name keeps its normal color.
function applyPaint(nameEl) {
  const css = settings.userColors && paintCss.get(userPaint.get(nameEl.dataset.uid));
  if (!css) return;
  nameEl.classList.add('painted');
  nameEl.style.backgroundImage = css.image;
  nameEl.style.backgroundSize = css.url ? 'cover' : '';
  nameEl.style.filter = css.shadows || '';
}

function repaintUser(userId) {
  document.querySelectorAll(`.name[data-uid="${userId}"]`).forEach(applyPaint);
}

function onPaintEvent(type, object) {
  if (!object) return;
  if (type === 'cosmetic.create' && object.kind === 'PAINT' && object.data) {
    const css = paintToCss(object.data);
    if (css) paintCss.set(object.id, css);
    return;
  }
  if (object.kind !== 'PAINT' || !object.user) return;
  const twitch = (object.user.connections || []).find((c) => c.platform === 'TWITCH');
  if (!twitch) return;
  if (type === 'entitlement.create') userPaint.set(twitch.id, object.ref_id);
  else if (type === 'entitlement.delete' && userPaint.get(twitch.id) === object.ref_id) userPaint.delete(twitch.id);
  repaintUser(twitch.id);
}

function connectPaints(roomId) {
  clearTimeout(paintTimer);
  if (paintSocket && paintRoom === roomId) return;
  if (paintSocket) {
    paintSocket.onclose = null;
    paintSocket.close();
  }
  if (paintRoom !== roomId) {
    // Paints of the previous channel's users aren't needed anymore (the test mode one stays).
    for (const id of userPaint.keys()) if (id !== 'demo-paint') userPaint.delete(id);
  }
  paintRoom = roomId;
  const sock = new WebSocket('wss://events.7tv.io/v3');
  paintSocket = sock;
  sock.onopen = () => {
    paintRetry = 0;
    for (const type of ['cosmetic.*', 'entitlement.*']) {
      sock.send(JSON.stringify({ op: 35, d: { type, condition: { ctx: 'channel', platform: 'TWITCH', id: roomId } } }));
    }
  };
  sock.onmessage = (e) => {
    try {
      const m = JSON.parse(e.data);
      if (m.op === 0 && m.d && m.d.body) onPaintEvent(m.d.type, m.d.body.object);
    } catch { /* strange message: ignore it */ }
  };
  // If it drops, try again with longer and longer waits (paints are an extra, no rush).
  sock.onclose = () => {
    if (paintSocket !== sock) return;
    paintSocket = null;
    paintTimer = setTimeout(() => connectPaints(roomId), Math.min(60000, 5000 * 2 ** paintRetry++));
  };
}
