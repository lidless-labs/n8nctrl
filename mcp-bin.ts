import { serve } from "./mcp-server.ts";

(process.argv.includes("--http")
  ? import("./src/http.ts").then(({ startHttpServer }) => startHttpServer())
  : serve()).catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`n8n-ops-mcp fatal: ${msg}`);
  process.exit(1);
});
