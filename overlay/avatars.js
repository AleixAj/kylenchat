// Profile pictures for the game styles that show an avatar (Fortnite, Rust).
// Until the picture arrives, the avatar shows the first letter of the name. Missing pictures
// are asked to Twitch together (up to 100 per query, the same query its website uses) and
// remembered: each person is only asked once.

const AVATAR_QUERY = 'query($ids:[ID!]){users(ids:$ids){id profileImageURL(width:70)}}';
const avatarCache = new Map(); // user id -> picture url ('' if they have none or it failed)
const avatarWaiting = new Map(); // user id -> avatars waiting for that picture
let avatarTimer = null;

function wantAvatar(userId, el) {
  if (!/^\d{1,20}$/.test(userId || '')) return;
  const url = avatarCache.get(userId);
  if (url !== undefined) {
    if (url) setAvatarImage(el, url);
    return;
  }
  if (!avatarWaiting.has(userId)) avatarWaiting.set(userId, []);
  avatarWaiting.get(userId).push(el);
  if (!avatarTimer) avatarTimer = setTimeout(fetchAvatars, 300); // groups the ones from several messages
}

async function fetchAvatars() {
  avatarTimer = null;
  const ids = [...avatarWaiting.keys()].slice(0, 100);
  if (!ids.length) return;
  let users = null;
  try {
    const res = await fetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: { 'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko', 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: AVATAR_QUERY, variables: { ids } }),
    });
    const body = await res.json();
    users = body && body.data && body.data.users;
  } catch { /* no connection: the letter stays and we try again with the next messages */ }
  if (Array.isArray(users)) {
    if (avatarCache.size > 3000) avatarCache.clear(); // memory limit for very long streams
    for (const id of ids) avatarCache.set(id, '');
    for (const u of users) {
      const url = u && u.profileImageURL;
      if (typeof url === 'string' && /^https:\/\/static-cdn\.jtvnw\.net\/[\w\-./]+$/.test(url)) avatarCache.set(String(u.id), url);
    }
  }
  for (const id of ids) {
    const els = avatarWaiting.get(id) || [];
    avatarWaiting.delete(id);
    const url = avatarCache.get(id);
    if (url) for (const el of els) setAvatarImage(el, url);
  }
  if (avatarWaiting.size) avatarTimer = setTimeout(fetchAvatars, 300);
}

// The picture is set once it has loaded, so we never see an empty gap.
function setAvatarImage(el, url) {
  const img = new Image();
  img.onload = () => {
    el.style.backgroundImage = `url("${url}")`;
    el.classList.add('has-img');
  };
  img.src = url;
}
