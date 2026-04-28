import type { Route } from "./+types/api.trip-stream";
import { subscribeTrip } from "../lib/firestore.server";
import {
  addConnection,
  listPresence,
  removeConnection,
  subscribePresence,
} from "../lib/presence.server";

// Server-Sent Events stream. Pushes one `update` event with the current doc
// as soon as we attach, then every change. Also pushes `presence` events
// whenever the roster of connected clients changes. EventSource on the client
// auto-reconnects.
export async function loader({ request }: Route.LoaderArgs) {
  const header = request.headers.get("X-Goog-Authenticated-User-Email");
  const userEmail = header ? (header.split(":").pop() ?? null) : null;
  const connectionId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          /* connection closed */
        }
      };

      // Heartbeat keeps proxies (and the browser) from closing the connection.
      const hb = setInterval(() => {
        try {
          controller.enqueue(enc.encode(": hb\n\n"));
        } catch {
          /* ignored */
        }
      }, 25_000);

      const unsubscribeTrip = subscribeTrip(
        (state, meta) => send("update", { state, meta }),
        () => send("error", { message: "subscribe failed" }),
      );

      // Register this connection and stream presence updates.
      addConnection(connectionId, userEmail);
      send("presence", listPresence());
      const unsubscribePresence = subscribePresence((users) =>
        send("presence", users),
      );

      const close = () => {
        clearInterval(hb);
        try {
          unsubscribeTrip();
        } catch {
          /* ignored */
        }
        try {
          unsubscribePresence();
        } catch {
          /* ignored */
        }
        removeConnection(connectionId);
        try {
          controller.close();
        } catch {
          /* ignored */
        }
      };

      request.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable buffering on proxies that respect this hint (e.g. nginx).
      "X-Accel-Buffering": "no",
    },
  });
}
