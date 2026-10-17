// Shared by content.js and popup.js.
// MoviePeek only runs on sites you switch on from its toolbar popup.

async function isSiteEnabled(api, host) {
  const { enabled = [] } = await api.storage.local.get("enabled");
  return enabled.includes(host);
}

async function setSiteEnabled(api, host, on) {
  let { enabled = [] } = await api.storage.local.get("enabled");
  enabled = enabled.filter((h) => h !== host);
  if (on) enabled.push(host);
  await api.storage.local.set({ enabled });
}
