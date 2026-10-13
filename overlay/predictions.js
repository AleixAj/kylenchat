// Channel predictions ("Who wins this round?").
// The changes arrive through the same public events as the channel points (points.js).
// Only the main chat listens to them: it passes each change to the main process, which
// shows the prediction in its own box on top of the game (prediction.html).

// When joining a channel we ask if a prediction is already running, because the events
// only tell what changes from now on. Same public query as Twitch's website, without logging in.
const PREDICTION_QUERY = 'query($login:String!){user(login:$login){channel{'
  + 'activePredictionEvents{...p} lockedPredictionEvents{...p}}}}'
  + 'fragment p on PredictionEvent{id title status createdAt predictionWindowSeconds '
  + 'outcomes{id title color totalPoints totalUsers}}';

let predictionShown = null; // the last prediction sent to the box (null if none)
const predictionOver = (p) => p.status === 'RESOLVED' || p.status === 'CANCELED';

// The query and the events write the same data in different ways: both end up like this.
function predictionFrom(e, winner) {
  return {
    id: String(e.id),
    title: String(e.title || ''),
    // While Twitch is closing it ("_PENDING") it looks the same as locked.
    status: String(e.status || '').replace(/^(RESOLVE|CANCEL)_PENDING$/, 'LOCKED'),
    createdAt: Date.parse(e.createdAt || e.created_at) || Date.now(),
    windowSeconds: Number(e.predictionWindowSeconds ?? e.prediction_window_seconds) || 0,
    winner: winner ? String(winner) : '',
    outcomes: (Array.isArray(e.outcomes) ? e.outcomes : []).map((o) => ({
      id: String(o.id),
      title: String(o.title || ''),
      color: String(o.color || ''),
      points: Number(o.totalPoints ?? o.total_points) || 0,
      users: Number(o.totalUsers ?? o.total_users) || 0,
    })),
  };
}

function sendPrediction(p) {
  predictionShown = p;
  api.vote('prediction', p);
}

// Another channel: the box stops showing the old one.
function forgetPrediction() {
  if (!WIN_ID && predictionShown) sendPrediction(null);
}

// Asks for the current prediction each time the events connect (also after a drop, in case
// we missed how it ended). If there's none and the box still shows one running, it closes.
async function loadPrediction(roomId) {
  if (WIN_ID) return;
  const channel = joined;
  try {
    const res = await fetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: { 'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko', 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: PREDICTION_QUERY, variables: { login: channel } }),
    });
    const data = await res.json();
    const ch = data && data.data && data.data.user && data.data.user.channel;
    if (!ch || channel !== joined || roomId !== pointsRoom) return;
    const event = (ch.activePredictionEvents || [])[0] || (ch.lockedPredictionEvents || [])[0];
    if (event) sendPrediction(predictionFrom(event));
    else if (predictionShown && !predictionOver(predictionShown)) sendPrediction(null);
  } catch { /* no internet: the events will bring the next one */ }
}

function onPredictionEvent(event) {
  if (WIN_ID || !event || (event.type !== 'event-created' && event.type !== 'event-updated')) return;
  const e = event.data && event.data.event;
  if (!e || !e.id || String(e.channel_id) !== String(pointsRoom)) return;
  sendPrediction(predictionFrom(e, e.winning_outcome_id));
}
