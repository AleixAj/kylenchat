// Asks which channels are live right now. No Twitch login is needed.
// Both functions return the same list format (the one api.ivr.fi uses),
// so main.js can treat the two sources the same way.
const { net } = require('electron');

// We ask Twitch directly, with the same public query its website uses: it sees a new
// stream within seconds. api.ivr.fi is only the backup, because it can take a few
// minutes to notice a stream that just started.
const TWITCH_GQL = 'https://gql.twitch.tv/gql';
const TWITCH_WEB_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko'; // the one from Twitch's public website
const LIVE_QUERY = 'query($logins:[String!]){users(logins:$logins){login displayName profileImageURL(width:300) '
  + 'broadcastSettings{title} stream{id createdAt type game{displayName}}}}';
const IVR_BATCH = 50; // channels per request to api.ivr.fi (Twitch takes all 100 at once)

async function fetchLiveFromTwitch(channels) {
  const res = await net.fetch(TWITCH_GQL, {
    method: 'POST',
    headers: { 'Client-Id': TWITCH_WEB_CLIENT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: LIVE_QUERY, variables: { logins: channels } }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Twitch HTTP ${res.status}`);
  const body = await res.json();
  const users = body && body.data && body.data.users;
  if (!Array.isArray(users)) throw new Error('respuesta inesperada de Twitch');
  // Turn Twitch's answer into the api.ivr.fi format.
  return users.filter(Boolean).map((u) => ({
    login: u.login,
    displayName: u.displayName,
    logo: u.profileImageURL,
    stream: u.stream && {
      id: u.stream.id,
      createdAt: u.stream.createdAt,
      type: u.stream.type,
      title: u.broadcastSettings && u.broadcastSettings.title,
      game: u.stream.game,
    },
  }));
}

async function fetchLiveFromIvr(channels) {
  const users = [];
  for (let i = 0; i < channels.length; i += IVR_BATCH) {
    const batch = channels.slice(i, i + IVR_BATCH);
    const res = await net.fetch(`https://api.ivr.fi/v2/twitch/user?login=${batch.join(',')}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`ivr HTTP ${res.status}`);
    const part = await res.json();
    if (!Array.isArray(part)) throw new Error('respuesta inesperada de ivr');
    users.push(...part);
  }
  return users;
}

module.exports = { fetchLiveFromTwitch, fetchLiveFromIvr };
