async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function getSettings() {
  const { channel = '', name = '', serverUrl = '' } = await chrome.storage.local.get(['channel', 'name', 'serverUrl']);
  return { channel, name, serverUrl };
}

function setStatus(message, ok = false) {
  const el = document.getElementById('status');
  el.textContent = message;
  el.className = 'hint ' + (ok ? 'ok' : 'err');
}

async function savePreferences() {
  const channel = document.getElementById('channel').value.trim();
  const name = document.getElementById('name').value.trim();
  const serverUrl = document.getElementById('serverUrl').value.trim();
  await chrome.storage.local.set({ channel, name, serverUrl });
  setStatus('Preferences saved.', true);
  // Ask the background service worker to reconnect with the new settings.
  chrome.runtime.sendMessage({ type: 'prefs-updated' });
}

async function shareCurrentTab() {
  const { channel, name, serverUrl } = await getSettings();
  if (!channel || !serverUrl) return setStatus('Please set a channel and server first.');
  const tab = await getCurrentTab();
  const url = tab?.url;
  const title = tab?.title || url;
  if (!url) return setStatus('Unable to detect the current tab URL.');
  try {
    const shareUrl = new URL('/share', serverUrl).toString();
    const res = await fetch(shareUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, url, title, from: name || 'anon' })
    });
    if (!res.ok) throw new Error('Failed to share the link.');
    setStatus('Link sent! ✔', true);
  } catch (error) {
    setStatus('Error: ' + error.message);
  }
}

(async () => {
  const prefs = await getSettings();
  document.getElementById('channel').value = prefs.channel;
  document.getElementById('name').value = prefs.name;
  document.getElementById('serverUrl').value = prefs.serverUrl;
  document.getElementById('save').addEventListener('click', savePreferences);
  document.getElementById('share').addEventListener('click', shareCurrentTab);
})();
