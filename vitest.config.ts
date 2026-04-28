import { defineConfig } from "vitest/config";

// A separate Vitest config so we don't load the React Router Vite plugin —
// that plugin tries to scan and register the app's routes, which isn't
// useful (and isn't compatible) when running unit tests over plain modules.
export default defineConfig({
  test: {
    include: ["app/**/*.{test,spec}.{ts,tsx}"],
    environment: "node",
    globals: false,
  },
});
