(async () => {
  const api = globalThis.browser ?? globalThis.chrome;
  if (window.top !== window || !(await isSiteEnabled(api, location.hostname))) return;
  const HOVER_DELAY = 120; // ignore links the cursor just sweeps across
  const HIDE_DELAY = 450; // time to move the cursor from the link onto the window

  // ---- release name -> { title, year } ----
  const QUALITY =
    /\b(2160p|1080p|720p|480p|4k|uhd|bluray|blu-ray|brrip|bdrip|web-?dl|webrip|web|hdtv|dvdrip|dvdscr|hdrip|hdcam|cam|ts|remux|x264|x265|h\.?264|h\.?265|hevc|xvid|aac|ac3|dts|hdr|10bit|proper|repack|extended|unrated|imax|multi|dual|s\d{1,2}e\d{1,2}|s\d{1,2}|season \d+|complete)\b/i;

  function parseName(raw) {
    let s = raw
      .replace(/^\s*[\[(][^\])]*[\])]\s*/, "") // leading [YTS] / (group)
      .replace(/[._]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    let year = null;
    // first year that isn't the very start of the name (so "2012 2009 1080p" works)
    const re = /[\[(]?\b(19[2-9]\d|20[0-4]\d)\b[\])]?/g;
    let m;
    while ((m = re.exec(s))) {
      if (m.index > 0) {
        year = Number(m[1]);
        s = s.slice(0, m.index);
        break;
      }
    }
    const q = s.search(QUALITY);
    if (q > 0) s = s.slice(0, q);

    const title = s.replace(/[\s\-–:([{]+$/, "").trim();
    return title.length >= 2 ? { title, year } : null;
  }

  // Links that look like a release name ("Some.Movie.2019.1080p…"), or detail-page
  // links in the formats common on download/listing sites.
  function isTitleLink(a) {
    const href = a.getAttribute("href") || "";
    const text = (a.textContent || "").trim();
    return (
      /\/(torrent|title|movie|film)s?\/\d+/i.test(href) ||
      href.includes("description.php") ||
      (text.length < 200 && /.\b(19[2-9]\d|20[0-4]\d)\b/.test(text))
    );
  }

  // ---- UI (shadow DOM so the page's CSS can't touch it) ----
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;top:0;left:0;z-index:2147483647;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
      .card {
        position: fixed; display: none; width: 340px; max-height: 300px; overflow-y: auto;
        overscroll-behavior: contain; padding: 12px; background: #1f1f1f; color: #eee;
        border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.45); font-size: 13px; line-height: 1.4;
      }
      .card.open { display: block; }
      .top { display: flex; gap: 12px; }
      .poster { width: 76px; height: 112px; object-fit: cover; border-radius: 4px; flex: none; background: #333; }
      .info { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
      .title { font-size: 15px; font-weight: 700; color: #fff; }
      .meta, .genres { color: #aaa; font-size: 12px; }
      .rating { font-size: 13px; color: #ddd; }
      .rating b { color: #f5c518; }
      .plot { margin: 10px 0 0; color: #ddd; }
      .stars { margin-top: 6px; color: #999; font-size: 12px; }
      .link { display: inline-block; margin-top: 8px; color: #f5c518; text-decoration: none; font-weight: 600; font-size: 12px; }
      .link:hover { text-decoration: underline; }
      .muted { color: #777; }
      .card::-webkit-scrollbar { width: 6px; }
      .card::-webkit-scrollbar-thumb { background: #555; border-radius: 3px; }
    </style>
    <div class="card">
      <div class="top">
        <img class="poster" alt="">
        <div class="info">
          <div class="title"></div>
          <div class="meta"></div>
          <div class="rating"></div>
          <div class="genres"></div>
        </div>
      </div>
      <div class="plot"></div>
      <div class="stars"></div>
      <a class="link" target="_blank" rel="noopener"></a>
    </div>`;
  document.documentElement.appendChild(host);

  const card = root.querySelector(".card");
  const $ = (sel) => root.querySelector(sel);

  let mouse = { x: 0, y: 0 };
  let activeLink = null;
  let hoverTimer, hideTimer;
  let token = 0;

  // ---- rendering ----
  const fmtVotes = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "K" : String(n));
  const fmtRuntime = (s) => {
    const m = Math.round(s / 60);
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
  };

  function renderBasic(query, res) {
    const r = res?.result;
    const img = $(".poster");
    const link = $(".link");
    $(".rating").textContent = "";
    $(".genres").textContent = "";
    $(".stars").textContent = "";
    if (!r) {
      $(".title").textContent = res?.error ? "Lookup failed" : "No IMDb match";
      $(".meta").textContent = query.title + (query.year ? ` (${query.year})` : "");
      $(".plot").textContent = res?.error || "";
      link.textContent = "Search IMDb ↗";
      link.href = `https://www.imdb.com/find/?q=${encodeURIComponent(query.title + (query.year ? " " + query.year : ""))}`;
      img.style.display = "none";
      return;
    }
    $(".title").textContent = r.title;
    $(".meta").textContent = [r.year, r.kind].filter(Boolean).join(" · ");
    $(".plot").innerHTML = '<span class="muted">Loading…</span>';
    $(".stars").textContent = r.stars;
    link.textContent = "Open on IMDb ↗";
    link.href = r.url;
    img.style.display = r.poster ? "" : "none";
    if (r.poster) {
      img.onerror = () => (img.style.display = "none");
      img.src = r.poster;
    }
  }

  function renderDetails(r, d) {
    if (!d) {
      $(".plot").textContent = "";
      return;
    }
    if (d.runtime) $(".meta").textContent = [r.year, r.kind, fmtRuntime(d.runtime)].filter(Boolean).join(" · ");
    $(".rating").innerHTML = d.rating
      ? `<b>★ ${d.rating.toFixed(1)}</b><span class="muted"> / 10 · ${fmtVotes(d.votes)} votes</span>`
      : '<span class="muted">Not rated yet</span>';
    $(".genres").textContent = d.genres.join(" · ");
    $(".plot").textContent = d.plot || "";
  }

  function place() {
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    let x = mouse.x + 16;
    let y = mouse.y + 16;
    if (x + w > innerWidth - 8) x = Math.max(8, mouse.x - w - 16);
    if (y + h > innerHeight - 8) {
      const above = mouse.y - h - 16;
      y = above >= 8 ? above : Math.max(8, innerHeight - h - 8);
    }
    card.style.left = x + "px";
    card.style.top = y + "px";
  }

  function open() {
    card.scrollTop = 0;
    card.classList.add("open");
    place();
  }

  function close() {
    card.classList.remove("open");
    restoreTooltip();
    activeLink = null;
    token++;
  }

  // The link's own tooltip would cover the window, so hide it while active.
  function suppressTooltip(a) {
    if (a.title) {
      a.dataset.moviepeekTitle = a.title;
      a.removeAttribute("title");
    }
  }
  function restoreTooltip() {
    if (activeLink?.dataset.moviepeekTitle) {
      activeLink.title = activeLink.dataset.moviepeekTitle;
      delete activeLink.dataset.moviepeekTitle;
    }
  }

  const scheduleHide = () => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(close, HIDE_DELAY);
  };

  async function show(a, parsed, my) {
    let res;
    try {
      res = await api.runtime.sendMessage({ type: "lookup", ...parsed });
    } catch (err) {
      res = { error: String(err?.message ?? err) };
    }
    if (my !== token) return;
    if (!res) res = { error: "No response from extension" };
    renderBasic(parsed, res);
    open();

    const r = res.result;
    if (!r) return;
    let d = null;
    try {
      d = (await api.runtime.sendMessage({ type: "details", id: r.id }))?.result;
    } catch {}
    if (my !== token) return;
    renderDetails(r, d);
    place(); // height changed
  }

  // ---- events ----
  document.addEventListener("mousemove", (e) => (mouse = { x: e.clientX, y: e.clientY }), { passive: true });

  document.addEventListener("mouseover", (e) => {
    const a = e.target.closest?.("a");
    if (!a || !isTitleLink(a)) return;
    clearTimeout(hideTimer);
    if (a === activeLink) return;
    const parsed = parseName(a.textContent || "");
    if (!parsed) return;

    restoreTooltip();
    activeLink = a;
    suppressTooltip(a);
    const my = ++token;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => my === token && show(a, parsed, my), HOVER_DELAY);
  });

  document.addEventListener("mouseout", (e) => {
    if (!activeLink || !activeLink.contains(e.target)) return;
    if (e.relatedTarget && (activeLink.contains(e.relatedTarget) || e.relatedTarget === host)) return;
    clearTimeout(hoverTimer);
    if (!card.classList.contains("open")) return close();
    scheduleHide();
  });

  card.addEventListener("mouseenter", () => clearTimeout(hideTimer));
  card.addEventListener("mouseleave", scheduleHide);
  document.addEventListener("keydown", (e) => e.key === "Escape" && close());
})();
