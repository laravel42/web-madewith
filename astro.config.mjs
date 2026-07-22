import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";

// The catalog is a network of per-technology showcase sites. In production each
// domain (madewithnuxt.com, madewithnode.com, …) is deployed from this one repo;
// here they share a build under /<slug> so the whole network is browsable at once.
// Local dev proxies the API paths to the Node app (server/). In production
// nginx does the same reverse-proxy in front of the built static site.
const apiServerUrl = process.env.API_SERVER_URL || "http://127.0.0.1:8787";
const apiProxyPaths = ["/admin/api", "/submit", "/newsletter", "/api/chat", "/data", "/config"];

export default defineConfig({
  site: "https://madewithwhat.net",
  integrations: [
    sitemap({
      // Keep the index clean: no admin UI, no thin utility pages (newsletter /
      // submit / llm), and no generated OG image endpoints.
      filter: (page) =>
        !/\/admin(\/|$)/.test(page) &&
        !/\/(newsletter|submit|llm)\/?$/.test(page) &&
        !/\/og\.png$/.test(page),
    }),
  ],
  build: { format: "directory" },
  devToolbar: { enabled: false },
  vite: {
    plugins: [tailwindcss()],
    server: {
      // Astro dev doesn't serve the API; proxy those paths to the Node app.
      proxy: Object.fromEntries(
        apiProxyPaths.map((p) => [
          p,
          { target: apiServerUrl, changeOrigin: true, timeout: 300_000, proxyTimeout: 300_000 },
        ]),
      ),
    },
  },
});
