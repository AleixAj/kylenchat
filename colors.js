// Small color helpers shared by the chat window and the settings window.
// Colors come as "#rrggbb" text.

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Many people pick very dark name colors (navy blue, black...) that can't be read on top of
// the game, so we mix them with white until they are bright enough.
const readableCache = new Map();
function readable(hex) {
  if (readableCache.has(hex)) return readableCache.get(hex);
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  const lum = () => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  for (let i = 0; i < 6 && lum() < 110; i++) {
    r += (255 - r) * 0.25;
    g += (255 - g) * 0.25;
    b += (255 - b) * 0.25;
  }
  const out = `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
  readableCache.set(hex, out);
  return out;
}

// White or black text, depending on how light the background color is.
function readableOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#111' : '#fff';
}
