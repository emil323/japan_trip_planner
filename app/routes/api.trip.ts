import type { Route } from "./+types/api.trip";
import { getTrip, saveTrip } from "../lib/firestore.server";
import type { TripState } from "../lib/trip";

export async function loader(_: Route.LoaderArgs) {
  const state = await getTrip();
  return Response.json(state);
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST" && request.method !== "PUT") {
    return new Response("Method not allowed", { status: 405 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return new Response("Invalid body", { status: 400 });
  }
  const state = body as TripState;
  if (!Array.isArray(state.locations) || typeof state.totalDays !== "number") {
    return new Response("Invalid trip state", { status: 400 });
  }
  await saveTrip(state);
  return Response.json({ ok: true });
}
