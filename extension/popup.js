(async () => {
  const api = globalThis.browser ?? globalThis.chrome;
  const hostEl = document.getElementById("host");
  const toggle = document.getElementById("toggle");

  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  let host = "";
  try {
    host = new URL(tab.url).hostname;
  } catch {}
  if (!host) {
    hostEl.textContent = "Not available on this page";
    return;
  }

  hostEl.textContent = host;
  toggle.checked = await isSiteEnabled(api, host);
  toggle.disabled = false;

  toggle.addEventListener("change", async () => {
    await setSiteEnabled(api, host, toggle.checked);
    api.tabs.reload(tab.id);
    window.close();
  });
})();
