// Looks titles up via IMDb's public suggestion endpoint (no API key needed).
// The request is made by the native app (SafariWebExtensionHandler.swift), since
// IMDb doesn't send CORS headers and Safari may not grant the extension IMDb access.
const api = globalThis.browser ?? globalThis.chrome;
const cache = new Map();
const TITLE_TYPES = new Set(["movie", "tvMovie", "tvSeries", "tvMiniSeries", "short", "video"]);

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const job = msg?.type === "lookup" ? lookup(msg.title, msg.year) : msg?.type === "details" ? details(msg.id) : null;
  if (!job) return;
  job.then(
    (result) => sendResponse({ result }),
    (err) => sendResponse({ error: String(err?.message ?? err) })
  );
  return true; // async response
});

async function getJson(url, body) {
  let nativeError;
  try {
    const res = await api.runtime.sendNativeMessage("moviepeek", { fetch: url, body });
    if (res?.body) return JSON.parse(res.body);
    nativeError = res?.error ?? "empty native response";
  } catch (e) {
    nativeError = e?.message ?? String(e);
  }
  // Fallback: works if Safari has granted the extension access to IMDb.
  try {
    const init = body ? { method: "POST", body, headers: { "content-type": "application/json", "x-imdb-client-name": "imdb-web-next-localized" } } : undefined;
    return await (await fetch(url, init)).json();
  } catch (e) {
    throw new Error(`Couldn't reach IMDb (${nativeError}; ${e?.message ?? e})`);
  }
}

async function lookup(title, year) {
  const key = `${title.toLowerCase()}|${year ?? ""}`;
  if (cache.has(key)) return cache.get(key);

  const q = title.toLowerCase().trim();
  const first = /[a-z0-9]/.test(q[0]) ? q[0] : "x";
  const data = await getJson(`https://v3.sg.media-imdb.com/suggestion/${first}/${encodeURIComponent(q)}.json`);

  const titles = (data.d ?? []).filter((i) => i.id?.startsWith("tt") && TITLE_TYPES.has(i.qid));
  const hit =
    (year && titles.find((i) => i.y === year)) ||
    (year && titles.find((i) => Math.abs((i.y ?? 0) - year) <= 1)) ||
    titles[0];

  const result = hit
    ? {
        id: hit.id,
        title: hit.l,
        year: hit.y ?? null,
        kind: hit.q === "feature" ? "Movie" : hit.q ?? "",
        stars: hit.s ?? "",
        poster: hit.i?.imageUrl ? hit.i.imageUrl.replace("._V1_.", "._V1_UX140_.") : null,
        url: `https://www.imdb.com/title/${hit.id}/`,
      }
    : null;

  cache.set(key, result);
  return result;
}

// Genre, rating, plot and runtime come from IMDb's GraphQL API.
const detailsCache = new Map();
const DETAILS_QUERY = `query ($id: ID!) { title(id: $id) {
  titleGenres { genres { genre { text } } }
  ratingsSummary { aggregateRating voteCount }
  plot { plotText { plainText } }
  runtime { seconds }
} }`;

async function details(id) {
  if (detailsCache.has(id)) return detailsCache.get(id);
  const data = await getJson("https://caching.graphql.imdb.com/", JSON.stringify({ query: DETAILS_QUERY, variables: { id } }));
  const t = data?.data?.title;
  if (!t) throw new Error("No details");
  const result = {
    genres: (t.titleGenres?.genres ?? []).map((g) => g.genre.text),
    rating: t.ratingsSummary?.aggregateRating ?? null,
    votes: t.ratingsSummary?.voteCount ?? 0,
    plot: t.plot?.plotText?.plainText ?? "",
    runtime: t.runtime?.seconds ?? null,
  };
  detailsCache.set(id, result);
  return result;
}
