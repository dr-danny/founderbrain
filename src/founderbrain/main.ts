/**
 * src/founderbrain/main.ts
 *
 * WHAT THIS IS. API process entry. Boots config, listens, and shuts down on signal.
 */
import { loadConfig } from "./config.ts";
import { buildApi } from "./server.ts";

const config = loadConfig();
const app = await buildApi(config, { serveWeb: config.FOUNDERBRAIN_LOCAL_DEMO === "true" });
await app.listen({
  port: config.PORT,
  host: config.FOUNDERBRAIN_LOCAL_DEMO === "true" ? "127.0.0.1" : "0.0.0.0",
});
// eslint-disable-next-line no-console -- this is a CLI entry point, not request-handling code
console.log(
  "FounderBrain API started. AI " +
    (config.AI_ENABLED === "true" ? "enabled with configured budgets." : "disabled."),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
