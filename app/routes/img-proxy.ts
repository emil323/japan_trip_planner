import type { Route } from "./+types/img-proxy";

// Resource route: GET /img-proxy?url=<remote image URL>
// Fetches the remote image bytes and streams them back same-origin so the
// browser can draw it onto a canvas without CORS taint. Used to convert
// hotel images to data URLs for persistent localStorage storage.

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export async function loader({ request }: Route.LoaderArgs) {
  const remote = new URL(request.url).searchParams.get("url");
  if (!remote || !/^https?:\/\//i.test(remote)) {
    return new Response("missing or invalid url", { status: 400 });
  }

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(remote, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": UA,
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
    }).finally(() => clearTimeout(t));

    if (!res.ok || !res.body) {
      return new Response(`upstream_${res.status}`, { status: 502 });
    }
    const ct = res.headers.get("content-type") || "image/jpeg";
    if (!ct.startsWith("image/")) {
      return new Response("not an image", { status: 415 });
    }

    return new Response(res.body, {
      status: 200,
      headers: {
        "Content-Type": ct,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return new Response("fetch_failed", { status: 502 });
  }
}
