import { fileURLToPath } from "node:url";
import path from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCors from "@fastify/cors";
import fastifyWebsocket from "@fastify/websocket";
import { getClaudeProcess } from "./claude-process.js";
import { chatRoute } from "./routes/chat.js";
import { graphRoutes } from "./routes/graph.js";
import { closeConnection } from "./kuzu-client.js";

const app = Fastify({ logger: true });

await app.register(fastifyCors, { origin: true });
await app.register(fastifyWebsocket);

// Serve built React app
const distDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../dist/ui",
);
await app.register(fastifyStatic, {
  root: distDir,
  prefix: "/",
  wildcard: false,
});

// SPA fallback
app.setNotFoundHandler(async (req, reply) => {
  if (req.url.startsWith("/api/")) {
    return reply.status(404).send({ error: "Not found" });
  }
  return reply.sendFile("index.html");
});

// Routes
await app.register(chatRoute, { prefix: "/api" });
await app.register(graphRoutes, { prefix: "/api" });

// Graceful shutdown
async function shutdown() {
  console.log("[ehr-ui] Shutting down...");
  const claude = getClaudeProcess();
  claude.stop();
  await closeConnection();
  await app.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const port = parseInt(process.env.UI_PORT ?? "4400", 10);
await app.listen({ port, host: "0.0.0.0" });
console.log(`[ehr-ui] server listening on http://localhost:${port}`);
