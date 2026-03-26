import type { FastifyPluginAsync } from "fastify";
import { readdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = join(fileURLToPath(import.meta.url), "../..");
const TEMPLATES_DIR = join(__dirname, "../../data/templates");

export const templateRoutes: FastifyPluginAsync = async (app) => {
  // List all templates
  app.get("/templates", async () => {
    const files = await readdir(TEMPLATES_DIR).catch(() => []);
    const templates = [];
    for (const file of files) {
      if (!file.endsWith(".md") && !file.endsWith(".txt")) continue;
      const content = await readFile(join(TEMPLATES_DIR, file), "utf-8");
      const name = file.replace(/\.(md|txt)$/, "").replace(/-/g, " ");
      templates.push({ id: file, name, content });
    }
    return templates;
  });

  // Get a single template
  app.get<{ Params: { id: string } }>("/templates/:id", async (req, reply) => {
    const filePath = join(TEMPLATES_DIR, req.params.id);
    try {
      const content = await readFile(filePath, "utf-8");
      const name = req.params.id.replace(/\.(md|txt)$/, "").replace(/-/g, " ");
      return { id: req.params.id, name, content };
    } catch {
      return reply.status(404).send({ error: "Template not found" });
    }
  });

  // Upload a new template
  app.post("/templates", async (req, reply) => {
    const { filename, content } = req.body as { filename: string; content: string };
    if (!filename || !content) {
      return reply.status(400).send({ error: "filename and content are required" });
    }
    // Sanitize filename
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase();
    const ext = safe.endsWith(".md") || safe.endsWith(".txt") ? "" : ".md";
    const finalName = safe + ext;
    await writeFile(join(TEMPLATES_DIR, finalName), content, "utf-8");
    return { id: finalName, name: finalName.replace(/\.(md|txt)$/, "").replace(/-/g, " ") };
  });

  // Delete a template
  app.delete<{ Params: { id: string } }>("/templates/:id", async (req, reply) => {
    try {
      await unlink(join(TEMPLATES_DIR, req.params.id));
      return { ok: true };
    } catch {
      return reply.status(404).send({ error: "Template not found" });
    }
  });
};
