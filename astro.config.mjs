import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

// The catalog is a network of per-technology showcase sites. In production each
// domain (madewithnuxt.com, madewithnode.com, …) is deployed from this one repo;
// here they share a build under /<slug> so the whole network is browsable at once.
export default defineConfig({
  site: "https://madewith.dev",
  integrations: [sitemap()],
  build: { format: "directory" },
});
