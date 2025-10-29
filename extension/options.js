(async () => {
  const { channel = '', name = '', serverUrl = '' } = await chrome.storage.local.get(['channel', 'name', 'serverUrl']);
  if (channel) document.getElementById('channel').value = channel;
  if (name) document.getElementById('name').value = name;
  if (serverUrl) document.getElementById('serverUrl').value = serverUrl;

  document.getElementById('save').addEventListener('click', async () => {
    const channel = document.getElementById('channel').value.trim();
    const name = document.getElementById('name').value.trim();
    const serverUrl = document.getElementById('serverUrl').value.trim();
    await chrome.storage.local.set({ channel, name, serverUrl });
    chrome.runtime.sendMessage({ type: 'prefs-updated' });
    alert('Saved!');
  });
})();
