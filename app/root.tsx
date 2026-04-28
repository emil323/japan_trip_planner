import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from "react-router";
import { useEffect, useState } from "react";

import type { Route } from "./+types/root";
import "./app.css";
import {
  onPresence,
  type PresenceUser,
} from "./lib/tripStream.client";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
  },
];

export async function loader({ request }: Route.LoaderArgs) {
  // IAP injects this header. Format: "accounts.google.com:user@example.com".
  const raw = request.headers.get("X-Goog-Authenticated-User-Email") ?? "";
  const userEmail = raw.includes(":") ? (raw.split(":").pop() ?? null) : raw || null;
  return { userEmail };
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nb" translate="no">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="google" content="notranslate" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  const data = useLoaderData<typeof loader>();
  const [presence, setPresence] = useState<PresenceUser[]>([]);
  useEffect(() => {
    return onPresence(setPresence);
  }, []);

  // Hide our own email so the chip list shows just the *other* people online.
  const others = data?.userEmail
    ? presence.filter((p) => p.email !== data.userEmail)
    : presence;

  return (
    <>
      <header className="app-topbar">
        <span className="app-topbar-brand">🗾 Japan-tur</span>
        <span className="app-topbar-spacer" />
        {others.length > 0 ? (
          <span
            className="app-topbar-presence"
            aria-label={`${others.length} andre pålogget`}
          >
            {others.map((p) => (
              <span
                key={p.email ?? "anon"}
                className="presence-chip"
                title={p.email ?? "Ukjent bruker"}
              >
                <span className="presence-chip-dot" aria-hidden />
                <span className="presence-chip-label">
                  {p.email ?? "Ukjent"}
                </span>
                {p.count > 1 ? (
                  <span className="presence-chip-count">×{p.count}</span>
                ) : null}
              </span>
            ))}
          </span>
        ) : null}
        <span className="app-topbar-user" title={data?.userEmail ?? "Lokal modus"}>
          {data?.userEmail ? (
            <>
              <span className="app-topbar-dot" aria-hidden />
              {data.userEmail}
            </>
          ) : (
            <span className="app-topbar-user--anon">Lokal modus</span>
          )}
        </span>
      </header>
      <Outlet />
    </>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="pt-16 p-4 container mx-auto">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
