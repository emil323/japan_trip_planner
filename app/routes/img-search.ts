import type { Route } from "./+types/img-search";

// Resource route: GET /img-search?q=<query>
// Server-side image search via DuckDuckGo (no API key, unofficial endpoint).
// Returns the first reasonable image URL.

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export async function loader({ request }: Route.LoaderArgs) {
  const q = new URL(request.url).searchParams.get("q");
  if (!q || !q.trim()) {
    return Response.json({ image: null, error: "missing_q" }, { status: 400 });
  }
  const query = q.trim().slice(0, 200);

  try {
    // Step 1: get the vqd token from the HTML page
    const tokenRes = await fetchWithTimeout(
      `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`,
      6000
    );
    if (!tokenRes.ok) return Response.json({ image: null, error: `token_http_${tokenRes.status}` });
    const tokenHtml = await tokenRes.text();
    const vqdMatch = tokenHtml.match(/vqd=["']?([\d-]+)/);
    if (!vqdMatch) return Response.json({ image: null, error: "no_vqd" });
    const vqd = vqdMatch[1];

    // Step 2: fetch the image results JSON
    const jsonUrl =
      `https://duckduckgo.com/i.js?l=us-en&o=json` +
      `&q=${encodeURIComponent(query)}` +
      `&vqd=${encodeURIComponent(vqd)}` +
      `&p=1&f=,,,,,&v7exp=a`;
    const imgRes = await fetchWithTimeout(jsonUrl, 6000, {
      Referer: "https://duckduckgo.com/",
      Accept: "application/json",
    });
    if (!imgRes.ok) return Response.json({ image: null, error: `img_http_${imgRes.status}` });
    const data = (await imgRes.json()) as {
      results?: Array<{ image?: string; thumbnail?: string; width?: number; height?: number }>;
    };
    const results = data.results ?? [];

    // Build a deduped list of usable image URLs (preferring decent dimensions).
    const seen = new Set<string>();
    const images: string[] = [];
    for (const r of results) {
      const img = r.image || r.thumbnail;
      if (!img) continue;
      if (!/^https?:\/\//i.test(img)) continue;
      if (r.width && r.width < 200) continue;
      if (seen.has(img)) continue;
      seen.add(img);
      images.push(img);
      if (images.length >= 20) break;
    }
    // Backfill with thumbnails if we somehow filtered everything out.
    if (images.length === 0) {
      for (const r of results) {
        const img = r.image || r.thumbnail;
        if (img && !seen.has(img)) {
          seen.add(img);
          images.push(img);
        }
        if (images.length >= 20) break;
      }
    }

    return Response.json(
      { image: images[0] ?? null, images },
      { headers: { "Cache-Control": "public, max-age=3600" } }
    );
  } catch (e) {
    return Response.json({ image: null, images: [], error: "search_failed" });
  }
}

async function fetchWithTimeout(
  url: string,
  ms: number,
  extraHeaders: Record<string, string> = {}
) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": UA,
        "Accept-Language": "en;q=0.9,nb;q=0.8",
        ...extraHeaders,
      },
    });
  } finally {
    clearTimeout(t);
  }
}
