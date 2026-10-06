// Channel point redemptions.
// Twitch only sends through the chat the redemptions that come with a written message.
// The others ("hydrate", "pick my champion"...) arrive by listening to the channel's public
// events, like Twitch's website does, without logging in. They are small and rare messages.

const POINTS_URL = 'wss://hermes.twitch.tv/v1?clientId=kimne78kx3ncx6brgo4mv6wki5h1ko';
let pointsSocket = null;
let pointsRoom = null;
let pointsTimer = null;
let pointsRetry = 0;
let pointsLastMessage = 0;
const rewardTitles = new Map(); // reward id -> name, for the redemptions that come with a message

function connectPoints(roomId) {
  clearTimeout(pointsTimer);
  if (pointsSocket && pointsRoom === roomId) return;
  if (pointsSocket) {
    pointsSocket.onclose = null;
    pointsSocket.close();
  }
  if (pointsRoom !== roomId) rewardTitles.clear();
  pointsRoom = roomId;
  const sock = new WebSocket(POINTS_URL);
  pointsSocket = sock;
  pointsLastMessage = Date.now();
  sock.onmessage = (e) => {
    pointsLastMessage = Date.now();
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    if (m.type === 'welcome') {
      pointsRetry = 0;
      sock.send(JSON.stringify({
        type: 'subscribe',
        id: 'points',
        subscribe: { id: 'points', type: 'pubsub', pubsub: { topic: `community-points-channel-v1.${roomId}` } },
        timestamp: new Date().toISOString(),
      }));
    } else if (m.type === 'notification' && m.notification && typeof m.notification.pubsub === 'string') {
      try { onPointsEvent(JSON.parse(m.notification.pubsub)); } catch { /* strange event: ignore it */ }
    }
  };
  // If it drops, try again with longer and longer waits.
  sock.onclose = () => {
    if (pointsSocket !== sock) return;
    pointsSocket = null;
    pointsTimer = setTimeout(() => connectPoints(roomId), Math.min(60000, 5000 * 2 ** pointsRetry++));
  };
}

// Twitch sends a signal every 10-15 s. If 45 s go by with nothing, the connection is dead: open it again.
setInterval(() => {
  if (pointsSocket && Date.now() - pointsLastMessage > 45000) pointsSocket.close();
}, 15000);

function onPointsEvent(event) {
  if (!event || event.type !== 'reward-redeemed') return;
  const red = event.data && event.data.redemption;
  if (!red || !red.reward || !red.user || String(red.channel_id) !== String(pointsRoom)) return;
  if (typeof red.reward.id === 'string' && typeof red.reward.title === 'string') {
    rewardTitles.set(red.reward.id, red.reward.title);
    if (rewardTitles.size > 300) rewardTitles.delete(rewardTitles.keys().next().value);
  }
  if (red.user_input) return; // this one arrives through the chat with its message and the redemption tag
  if (testMode || !settings.showRedemptions) return;
  const login = String(red.user.login || '').toLowerCase();
  if (isFiltered({ user: login, text: '' })) return;
  addRedeemNotice({
    name: red.user.display_name || login,
    title: String(red.reward.title || ''),
    cost: Number(red.reward.cost) || 0,
    color: /^#[0-9a-f]{6}$/i.test(red.reward.background_color) ? red.reward.background_color : '#9146ff',
  });
}

// Redemption without a message, with the color the streamer gave to the reward.
function addRedeemNotice({ name, title, cost, color }) {
  const el = document.createElement('div');
  el.className = 'msg notice redeem-notice';
  el.style.setProperty('--edge', color);
  const text = document.createElement('div');
  text.className = 'notice-title';
  text.textContent = tr('noticeRedeem', { name, reward: title, cost: cost.toLocaleString(settings.language) });
  el.append(text);
  push(el);
}
