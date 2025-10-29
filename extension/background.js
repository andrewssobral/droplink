let ws = null;
let reconnectTimer = null;
let pollTimer = null;
let lastSeenId = null;
let current = { channel: null, serverUrl: null };
const notificationPayloads = new Map();
const LAST_SEEN_KEY = 'droplink:lastSeenByChannel';
let notificationPermissionWarned = false;

async function loadPreferences() {
  const { channel = '', serverUrl = '' } = await chrome.storage.local.get(['channel', 'serverUrl']);
  return { channel, serverUrl };
}

function notifyLink(payload) {
  const notificationId = 'droplink-' + payload.id;
  notificationPayloads.set(notificationId, payload);
  chrome.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: 'icon-128.png',
    title: `New link from ${payload.from}`,
    message: payload.title || payload.url,
    contextMessage: new URL(payload.url).host,
    priority: 2,
    buttons: [{ title: 'Open' }]
  });
}

chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  if (buttonIndex !== 0) return;
  const payload = notificationPayloads.get(notificationId);
  if (!payload) return;
  chrome.tabs.create({ url: payload.url });
  chrome.notifications.clear(notificationId);
  notificationPayloads.delete(notificationId);
});

chrome.notifications.onClosed.addListener((notificationId) => {
  notificationPayloads.delete(notificationId);
});

function stopPoll() {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

function closeSocket() {
  if (ws) {
    try { ws.close(); } catch (err) { console.error('Failed to close socket', err); }
    ws = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function connect() {
  if (!current.channel || !current.serverUrl) {
    closeSocket();
    stopPoll();
    return;
  }

  const wsUrl = new URL('/ws', current.serverUrl);
  wsUrl.protocol = wsUrl.protocol.replace(/^http/, 'ws');
  wsUrl.searchParams.set('channel', current.channel);

  closeSocket();

  ws = new WebSocket(wsUrl.toString());

  ws.addEventListener('open', () => {
    // Keep-alive connection; Chrome keeps the worker active while the socket is open.
  });

  ws.addEventListener('message', async event => {
    try {
      const message = JSON.parse(event.data);
      if (message.event === 'new-link') {
        await handleIncoming(message.data);
      }
    } catch (error) {
      console.error('Failed to parse message', error);
    }
  });

  ws.addEventListener('close', (event) => {
    console.warn('WebSocket closed', event.code, event.reason);
    reconnectTimer = setTimeout(connect, 3000);
  });

  ws.addEventListener('error', (error) => {
    console.error('WebSocket error', error);
    reconnectTimer = setTimeout(connect, 3000);
  });
}

async function init() {
  current = await loadPreferences();
  lastSeenId = await getLastSeenId(current.channel);
  await seedLatest();
  connect();
  schedulePoll(true);
}

chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);
chrome.runtime.onMessage.addListener(async (message) => {
  if (message?.type === 'prefs-updated') {
    current = await loadPreferences();
    lastSeenId = await getLastSeenId(current.channel);
    await seedLatest();
    connect();
    schedulePoll(true);
  }
});
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  if ('channel' in changes || 'serverUrl' in changes) {
    current = await loadPreferences();
    lastSeenId = await getLastSeenId(current.channel);
    await seedLatest();
    connect();
    schedulePoll(true);
  }
});

init();

function schedulePoll(immediate = false) {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(runPoll, immediate ? 0 : 5000);
}

async function runPoll() {
  if (!current.channel || !current.serverUrl) {
    schedulePoll();
    return;
  }
  try {
    const latestUrl = new URL('/latest', current.serverUrl);
    latestUrl.searchParams.set('channel', current.channel);
    const res = await fetch(latestUrl.toString(), { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    if (payload && payload.id) {
      await handleIncoming(payload);
    }
  } catch (error) {
    console.error('Polling latest link failed', error);
  } finally {
    schedulePoll();
  }
}

async function handleIncoming(payload) {
  if (!payload) return;
  const latestSeen = await getLastSeenId(current.channel);
  if (payload.id === latestSeen) return;
  await setLastSeenId(current.channel, payload.id);
  notifyLink(payload);
}

async function seedLatest() {
  if (!current.channel || !current.serverUrl) return;
  try {
    const latestUrl = new URL('/latest', current.serverUrl);
    latestUrl.searchParams.set('channel', current.channel);
    const res = await fetch(latestUrl.toString(), { cache: 'no-store' });
    if (res.ok) {
      const payload = await res.json();
      if (payload?.id) {
        await setLastSeenId(current.channel, payload.id);
      }
    }
  } catch (error) {
    console.error('Unable to seed latest link', error);
  }
}

async function getLastSeenMap() {
  const { [LAST_SEEN_KEY]: map = {} } = await chrome.storage.local.get(LAST_SEEN_KEY);
  return map;
}

async function getLastSeenId(channel) {
  if (!channel) return null;
  if (lastSeenId && current.channel === channel) return lastSeenId;
  const map = await getLastSeenMap();
  return map[channel] || null;
}

async function setLastSeenId(channel, id) {
  if (!channel || !id) return;
  const map = await getLastSeenMap();
  map[channel] = id;
  lastSeenId = id;
  await chrome.storage.local.set({ [LAST_SEEN_KEY]: map });
}
