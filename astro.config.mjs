import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";

// The catalog is a network of per-technology showcase sites. In production each
// domain (madewithnuxt.com, madewithnode.com, …) is deployed from this one repo;
// here they share a build under /<slug> so the whole network is browsable at once.
const adminWorkerUrl = process.env.ADMIN_WORKER_URL || "http://127.0.0.1:8787";

export default defineConfig({
  site: "https://madewithwhat.net",
  integrations: [sitemap()],
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
