import type { Route } from "./+types/home";
import { TripPlanner } from "../components/TripPlanner";
import { getTrip } from "../lib/firestore.server";
import { defaultState } from "../lib/trip";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Japan-reiseplanlegger" },
    {
      name: "description",
      content: "Planlegg hvor mange dager du skal være på hvert sted i Japan-reisen.",
    },
  ];
}

export async function loader(_: Route.LoaderArgs) {
  // Ship the trip state in the initial HTML so the client doesn't have to
  // round-trip /api/trip on first paint. Falls back to defaultState if
  // Firestore is unavailable (e.g. expired local credentials in dev).
  try {
    const state = await getTrip();
    return { state };
  } catch {
    return { state: defaultState() };
  }
}

export default function Home({ loaderData }: Route.ComponentProps) {
  return <TripPlanner initialState={loaderData.state} />;
}
