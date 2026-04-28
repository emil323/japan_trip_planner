import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("og", "routes/og.ts"),
  route("img-search", "routes/img-search.ts"),
  route("img-proxy", "routes/img-proxy.ts"),
  route("plan/:id", "routes/plan.tsx"),
  route("oppsummering", "routes/summary.tsx"),
  route("api/trip", "routes/api.trip.ts"),
  route("api/trip/stream", "routes/api.trip-stream.ts"),
] satisfies RouteConfig;
