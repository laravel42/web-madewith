import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";

// The catalog is a network of per-technology showcase sites. In production each
// domain (madewithnuxt.com, madewithnode.com, …) is deployed from this one repo;
// here they share a build under /<slug> so the whole network is browsable at once.
const adminWorkerUrl = process.env.ADMIN_WORKER_URL || "http://127.0.0.1:8787";

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
      // Astro dev does not run Pages Functions; proxy admin API to the Worker.
      proxy: {
        "/admin/api": {
          target: adminWorkerUrl,
          changeOrigin: true,
          timeout: 300_000,
          proxyTimeout: 300_000,
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              proxyReq.setHeader("x-admin-dev-bypass", "1");
            });
          },
        },
      },
    },
  },
});
