// Turns the raw lines of Twitch's chat (IRC) into simple objects the chat window can show.

// Twitch tag values come "escaped" (\s = space, etc.).
function unescapeTag(value) {
  return value.replace(/\\(.)/g, (_, c) => ({ s: ' ', ':': ';', r: '\r', n: '\n', '\\': '\\' }[c] || c));
}

// A line looks like "@tags :prefix COMMAND params :trailing text". Every part except the command is optional.
function parse(line) {
  const tags = {};
  if (line[0] === '@') {
    const i = line.indexOf(' ');
    for (const kv of line.slice(1, i).split(';')) {
      const j = kv.indexOf('=');
      tags[kv.slice(0, j)] = kv.slice(j + 1);
    }
    line = line.slice(i + 1);
  }
  let prefix = '';
  if (line[0] === ':') {
    const i = line.indexOf(' ');
    prefix = line.slice(1, i);
    line = line.slice(i + 1);
  }
  let trailing = null;
  const t = line.indexOf(' :');
  if (t !== -1) {
    trailing = line.slice(t + 2);
    line = line.slice(0, t);
  }
  const [command, ...params] = line.split(' ');
  return { tags, prefix, command, params, trailing };
}

function messageFrom(m) {
  const { tags } = m;
  const user = tags.login || m.prefix.split('!')[0];
  return {
    id: tags.id,
    user,
    name: tags['display-name'] || user,
    color: tags.color,
    emotes: tags.emotes,
    text: m.trailing || '',
    userId: tags['user-id'] || '',
    // In shared chat, the badges from the original channel come in source-badges.
    badges: tags['source-badges'] || tags.badges || '',
    sourceRoom: tags['source-room-id'] || '',
    sourceId: tags['source-id'] || '',
    first: tags['first-msg'] === '1',
    bits: Number(tags.bits) || 0,
    highlighted: tags['msg-id'] === 'highlighted-message',
    redeem: Boolean(tags['custom-reward-id']),
    rewardId: tags['custom-reward-id'] || '',
    reply: tags['reply-parent-display-name']
      ? { name: tags['reply-parent-display-name'], body: unescapeTag(tags['reply-parent-msg-body'] || '') }
      : null,
  };
}

// Text of a highlighted notice: "X subscribed", "Y is raiding with 50 viewers"...
// Twitch only sends the notice text in English ("system-msg"). For the types we know,
// we build it in the app language with the notice data; for the rest we use
// Twitch's text as it comes.
const ANON_GIFTERS = new Set(['ananonymousgifter', 'ananonymouscheerer']);

function noticeText(tags) {
  const p = (key) => unescapeTag(tags[`msg-param-${key}`] || '');
  const user = unescapeTag(tags['display-name'] || tags.login || '');
  const name = ANON_GIFTERS.has(tags.login) ? tr('anonymous') : user;
  const planCode = p('sub-plan');
  const plan = planCode === 'Prime' ? tr('planPrime') : tr('planTier', { n: String(Number(planCode) / 1000 || 1) });
  const months = Number(p('cumulative-months')) || 0;
  const sender = p('sender-name') || p('prior-gifter-display-name');

  // Notices that come from another channel of a shared chat have their real type in source-msg-id.
  const type = tags['msg-id'] === 'sharedchatnotice' ? tags['source-msg-id'] : tags['msg-id'];
  switch (type) {
    case 'sub':
      return tr('noticeSub', { name, plan });
    case 'resub':
      return months > 1 ? tr('noticeResub', { name, plan, months }) : tr('noticeSub', { name, plan });
    case 'subgift': {
      const giftMonths = Number(p('gift-months')) || 1;
      const recipient = p('recipient-display-name');
      return giftMonths > 1
        ? tr('noticeSubGiftMonths', { name, plan, recipient, months: giftMonths })
        : tr('noticeSubGift', { name, plan, recipient });
    }
    case 'submysterygift':
      return tr('noticeMysteryGift', { name, plan, count: p('mass-gift-count') });
    case 'raid':
      return tr('noticeRaid', { name: p('displayName') || user, count: p('viewerCount') });
    case 'viewermilestone':
      if (p('category') === 'watch-streak') return tr('noticeWatchStreak', { name, count: p('value') });
      break;
    case 'giftpaidupgrade':
      return tr('noticeGiftUpgrade', { name, sender });
    case 'anongiftpaidupgrade':
      return tr('noticeGiftUpgradeAnon', { name });
    case 'primepaidupgrade':
      return tr('noticePrimeUpgrade', { name, plan });
    case 'bitsbadgetier':
      return tr('noticeBitsBadge', { name, count: p('threshold') });
    case 'standardpayforward':
      return tr('noticePayForward', { name, sender });
    case 'communitypayforward':
      return tr('noticePayForwardCommunity', { name, sender });
  }
  return unescapeTag(tags['system-msg'] || '');
}
