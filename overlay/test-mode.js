// Test mode: fills the chat with sample messages that keep coming by themselves, so the
// user can change the look and see how it will be. While it's on, the real chat is ignored.

// The samples are in i18n.js, in the chosen language.
const samples = () => i18n.SAMPLES[settings.language] || i18n.SAMPLES.es;
// Official Twitch emotes used in the samples (7TV/BTTV add the rest).
const TWITCH_TEST_EMOTES = { Kappa: 25, LUL: 425618, PogChamp: 305954156 };

let testMode = false;
let testTimer = null;
let sampleIndex = 0;

// Sample paint (pink-purple-blue gradient) to show what 7TV paints look like.
paintCss.set('demo', paintToCss({ function: 'LINEAR_GRADIENT', angle: 90, stops: [
  { at: 0, color: 0xff5fa2ff }, { at: 0.5, color: 0xb070ffff }, { at: 1, color: 0x4fc3ffff },
] }));
userPaint.set('demo-paint', 'demo');

// Builds a message like the ones from Twitch, including the positions of the Twitch emotes.
function sampleMessage([name, color, rawText, extras]) {
  const text = rawText.split('{channel}').join(joined || 'streamer');
  const byId = {};
  let pos = 0;
  for (const word of text.split(' ')) {
    const len = Array.from(word).length;
    const id = TWITCH_TEST_EMOTES[word];
    if (id) (byId[id] = byId[id] || []).push(`${pos}-${pos + len - 1}`);
    pos += len + 1;
  }
  const emotes = Object.entries(byId).map(([id, ranges]) => `${id}:${ranges.join(',')}`).join('/');
  return { id: '', user: name.toLowerCase(), name, color, emotes, text, badges: '', ...extras };
}

function testMessage() {
  const list = samples();
  const sample = list[sampleIndex++ % list.length];
  if (Array.isArray(sample)) addMessage(sampleMessage(sample));
  else if (sample.redeem) { if (settings.showRedemptions) addRedeemNotice(sample.redeem); }
  else addNotice(sample.notice, sample.msg ? sampleMessage(sample.msg) : null);
}

function clearChat() {
  pending = [];
  chat.replaceChildren();
}

function setTestMode(on) {
  if (on === testMode) return;
  testMode = on;
  clearInterval(testTimer);
  clearChat();
  // In test mode the bar shows a sample channel and viewer count, to see how it looks.
  document.getElementById('barChannel').textContent = on ? '#kylen' : (joined ? `#${joined}` : '');
  if (on) {
    clearInterval(viewersTimer);
    document.getElementById('barViewers').textContent = (1234).toLocaleString(settings.language);
    const first = Math.min(settings.maxMessages, samples().length);
    for (let i = 0; i < first; i++) testMessage();
    testTimer = setInterval(testMessage, 1500);
  } else {
    startViewers();
    system(joined ? tr('chatOf', { channel: joined }) : tr('enterChannel'));
  }
}
