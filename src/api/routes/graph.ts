import type { FastifyPluginAsync } from "fastify";
import { neighborhoodQuery, searchNodes } from "../kuzu-client.js";

export const graphRoutes: FastifyPluginAsync = async (app) => {
  app.get<{
    Querystring: { id: string; type?: string; maxNodes?: string };
  }>("/graph/neighborhood", async (req, reply) => {
    const { id, type = "Patient", maxNodes = "30" } = req.query;
    if (!id) return reply.status(400).send({ error: "id is required" });
    const subgraph = await neighborhoodQuery(id, type, parseInt(maxNodes, 10));
    return subgraph;
  });

  app.get<{
    Querystring: { q: string; limit?: string };
  }>("/graph/search", async (req, reply) => {
    const { q, limit = "10" } = req.query;
    if (!q) return reply.status(400).send({ error: "q is required" });
    const results = await searchNodes(q, parseInt(limit, 10));
    return results;
  });
};
