import type { Route } from "./+types/og";

// Resource route: GET /og?url=<bookingUrl>
// Server-side fetches the URL and extracts og:image / twitter:image meta tag.
// Bypasses browser CORS restrictions.

export async function loader({ request }: Route.LoaderArgs) {
  const u = new URL(request.url).searchParams.get("url");
  if (!u) return Response.json({ image: null, title: null }, { status: 400 });

  let target: URL;
  try {
    target = new URL(u);
  } catch {
    return Response.json({ image: null, error: "invalid_url" }, { status: 400 });
  }

  // Basic SSRF guard: only http(s), no localhost / private hosts
  if (!/^https?:$/.test(target.protocol)) {
    return Response.json({ image: null, error: "bad_protocol" }, { status: 400 });
  }
  const host = target.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^127\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    return Response.json({ image: null, error: "blocked_host" }, { status: 400 });
  }

  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(target.toString(), {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        // Pretend to be a regular browser; some sites (e.g. Booking.com) block bots.
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en;q=0.9,nb;q=0.8",
      },
    });
    clearTimeout(timeout);
    if (!res.ok) return Response.json({ image: null, title: titleFromUrl(target), error: `http_${res.status}` });

    // Read up to ~256 KB; og tags are almost always in <head>
    const reader = res.body?.getReader();
    if (!reader) return Response.json({ image: null, title: titleFromUrl(target), error: "no_body" });

    const decoder = new TextDecoder("utf-8", { fatal: false });
    let html = "";
    let bytesRead = 0;
    const MAX = 256 * 1024;
    while (bytesRead < MAX) {
      const { value, done } = await reader.read();
      if (done) break;
      bytesRead += value.length;
      html += decoder.decode(value, { stream: true });
      if (html.includes("</head>")) break;
    }
    try { reader.cancel(); } catch {}

    const image = extractOgImage(html, target);
    const title = extractOgTitle(html) || titleFromUrl(target);
    return Response.json(
      { image, title },
      {
        headers: {
          // Cache results for an hour
          "Cache-Control": "public, max-age=3600",
        },
      }
    );
  } catch (e) {
    // Network/fetch failed (e.g. site blocked us). Fall back to URL-derived title.
    return Response.json({ image: null, title: titleFromUrl(target), error: "fetch_failed" });
  }
}

// Derive a human-readable hotel/page name from the URL when the page can't be parsed.
// Examples:
//   booking.com/hotel/jp/hakata-miyako.no.html        -> "Hakata Miyako"
//   hotels.com/Hotel-Search?destination=Spar Hotel... -> "Spar Hotel Majorna"
//   airbnb.com/rooms/12345                            -> null (numeric, not useful)
function titleFromUrl(u: URL): string | null {
  // 1. Check common query parameters that often carry the hotel/destination name.
  const hintParams = [
    "destination",
    "hotelName",
    "hotel_name",
    "hotel",
    "name",
    "q",
    "query",
    "label",
  ];
  const genericValues = new Set([
    "hotel", "hotels", "search", "hotel search", "hotel-search",
  ]);
  for (const p of hintParams) {
    const v = u.searchParams.get(p);
    if (!v) continue;
    const cleaned = v.trim();
    if (!cleaned || cleaned.length < 3) continue;
    if (/^\d+$/.test(cleaned)) continue;
    if (genericValues.has(cleaned.toLowerCase())) continue;
    // Looks like a real name: keep as-is if it has spaces, otherwise prettify slug.
    return /\s/.test(cleaned) ? cleaned : prettifySlug(cleaned);
  }

  const segs = u.pathname.split("/").filter(Boolean);
  if (segs.length === 0) return null;

  // Booking.com pattern: /hotel/<cc>/<slug>.<lang>.html
  if (u.hostname.includes("booking.") && segs[0] === "hotel" && segs.length >= 3) {
    return prettifySlug(segs[2].replace(/\.[a-z-]+\.html?$/i, "").replace(/\.html?$/i, ""));
  }

  // Generic: take the last path segment, strip extension and trailing locale codes.
  const last = segs[segs.length - 1]
    .replace(/\.[a-z]{2,3}(-[a-z]{2})?\.html?$/i, "")
    .replace(/\.html?$/i, "");

  if (!last || /^\d+$/.test(last)) return null;
  const pretty = prettifySlug(last);
  if (pretty && genericValues.has(pretty.toLowerCase())) return null;
  return pretty;
}

function prettifySlug(slug: string): string | null {
  const cleaned = slug.replace(/[-_]+/g, " ").trim();
  if (!cleaned || cleaned.length < 2) return null;
  return cleaned
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function extractOgTitle(html: string): string | null {
  const patterns: RegExp[] = [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
    /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:title["']/i,
    /<title[^>]*>([^<]+)<\/title>/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) {
      const t = decodeEntities(m[1]).trim();
      if (t) return t;
    }
  }
  return null;
}

function extractOgImage(html: string, base: URL): string | null {
  // Try a few common variants
  const patterns: RegExp[] = [
    /<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image:secure_url["']/i,
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) {
      try {
        return new URL(m[1], base).toString();
      } catch {
        return null;
      }
    }
  }
  return null;
}
