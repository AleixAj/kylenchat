// Channel polls (2 to 5 answers). Same idea as predictions.js: the main chat gets each change
// and passes it to the main process, which shows it in its own box (prediction.html?kind=poll).
// The changes arrive through the public events (points.js). In case Twitch doesn't send them
// to viewers without an account, we also ask every few seconds while a poll is running, and
// once in a while to find out when a new one starts. They are very small requests.

const POLL_QUERY = 'query($login:String!){user(login:$login){viewablePoll{id title status startedAt '
  + 'durationSeconds remainingDurationMilliseconds totalVoters votes{total} choices{id title totalVoters votes{total}}}}}';
const POLL_CHECK_RUNNING_MS = 5000;
const POLL_CHECK_IDLE_MS = 45000;

let pollShown = null; // the last poll sent to the box (null if none)
let pollTimer = null;

// Twitch's states, turned into the ones the box knows. Polls end with a result; the rest
// (archived, removed by moderators...) means there's nothing to show.
const POLL_STATUS = { ACTIVE: 'ACTIVE', COMPLETED: 'RESOLVED', TERMINATED: 'RESOLVED' };

// The query and the events write the same data in different ways: both end up like this.
function pollFrom(p) {
  const status = POLL_STATUS[p.status];
  if (!status) return null;
  const duration = Number(p.durationSeconds ?? p.duration_seconds) || 0;
  const remaining = Number(p.remainingDurationMilliseconds ?? p.remaining_duration_milliseconds);
  const started = Date.parse(p.startedAt || p.started_at) || Date.now();
  const outcomes = (Array.isArray(p.choices) ? p.choices : []).map((c) => ({
    id: String(c.id || c.choice_id),
    title: String(c.title || ''),
    points: Number(c.votes && c.votes.total) || 0, // votes (they can be more than people, with bits or points)
    users: Number(c.totalVoters ?? c.total_voters) || 0,
  }));
  const top = Math.max(...outcomes.map((o) => o.points));
  return {
    id: String(p.id || p.poll_id),
    title: String(p.title || ''),
    status,
    // Counted from the time left (when Twitch gives it), so a wrong PC clock doesn't matter.
    createdAt: Number.isFinite(remaining) && status === 'ACTIVE' ? Date.now() + remaining - duration * 1000 : started,
    windowSeconds: duration,
    winner: status === 'RESOLVED' && top > 0 ? outcomes.find((o) => o.points === top).id : '',
    outcomes,
  };
}

const pollOver = (p) => p.status === 'RESOLVED';

function sendPoll(p) {
  // The same ended poll keeps coming in the checks: sending it again would bring it back to the screen.
  if (JSON.stringify(p) !== JSON.stringify(pollShown)) api.vote('poll', p);
  pollShown = p;
  schedulePollCheck();
}

function forgetPoll() {
  if (!WIN_ID && pollShown) sendPoll(null);
}

async function loadPoll(roomId) {
  if (WIN_ID || !joined) return;
  const channel = joined;
  try {
    const res = await fetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: { 'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko', 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: POLL_QUERY, variables: { login: channel } }),
    });
    const data = await res.json();
    const user = data && data.data && data.data.user;
    if (!user || channel !== joined || (roomId && roomId !== pointsRoom)) return;
    const poll = user.viewablePoll && pollFrom(user.viewablePoll);
    if (poll && (poll.status === 'ACTIVE' || (pollShown && pollShown.id === poll.id))) {
      sendPoll(poll); // a running poll, or how the one on screen ended
    } else if (pollShown && !pollOver(pollShown)) {
      sendPoll(null); // the one on screen is gone
    }
  } catch { /* no internet: we'll try again later */ }
  schedulePollCheck();
}

// Often while a poll runs, rarely when there's none.
function schedulePollCheck() {
  clearTimeout(pollTimer);
  if (WIN_ID || !joined) return;
  const running = pollShown && !pollOver(pollShown);
  pollTimer = setTimeout(() => loadPoll(pointsRoom), running ? POLL_CHECK_RUNNING_MS : POLL_CHECK_IDLE_MS);
}

function onPollEvent(event) {
  if (WIN_ID || !event || typeof event.type !== 'string' || !event.type.startsWith('POLL_')) return;
  const p = event.data && event.data.poll;
  if (!p || (p.owned_by && String(p.owned_by) !== String(pointsRoom))) return;
  const poll = pollFrom(p);
  if (poll) sendPoll(poll);
  else if (pollShown && pollShown.id === String(p.poll_id)) sendPoll(null);
}
