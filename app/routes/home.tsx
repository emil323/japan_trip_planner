import type { Route } from "./+types/home";
import { TripPlanner } from "../components/TripPlanner";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Japan-reiseplanlegger" },
    {
      name: "description",
      content: "Planlegg hvor mange dager du skal være på hvert sted i Japan-reisen.",
    },
  ];
}

export default function Home() {
  return <TripPlanner />;
}
