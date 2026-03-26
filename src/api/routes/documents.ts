import type { FastifyPluginAsync } from "fastify";
import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, BorderStyle,
} from "docx";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const DOCS_DIR = join(PROJECT_ROOT, "data/documents");

/** Convert markdown text to docx Document */
function mdToDocx(markdown: string): Document {
  const lines = markdown.split("\n");
  const children: Paragraph[] = [];

  let inTable = false;
  let tableRows: string[][] = [];

  function flushTable() {
    if (tableRows.length === 0) return;
    const rows = tableRows.filter(r => !r.every(c => /^[-|:\s]+$/.test(c))); // skip separator rows
    if (rows.length > 0) {
      try {
        const table = new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: rows.map((cells, i) =>
            new TableRow({
              children: cells.map(cell =>
                new TableCell({
                  width: { size: Math.floor(100 / cells.length), type: WidthType.PERCENTAGE },
                  borders: {
                    top: { style: BorderStyle.SINGLE, size: 1, color: "cccccc" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "cccccc" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "cccccc" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "cccccc" },
                  },
                  children: [new Paragraph({
                    children: [new TextRun({
                      text: cell.trim(),
                      bold: i === 0,
                      size: 20,
                    })],
                  })],
                })
              ),
            })
          ),
        });
        children.push(new Paragraph({ children: [] })); // spacer
        children.push(table as unknown as Paragraph); // docx typing workaround
      } catch { /* skip malformed tables */ }
    }
    tableRows = [];
    inTable = false;
  }

  for (const line of lines) {
    // Table row
    if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
      inTable = true;
      const cells = line.split("|").slice(1, -1).map(c => c.trim());
      tableRows.push(cells);
      continue;
    } else if (inTable) {
      flushTable();
    }

    const trimmed = line.trim();
    if (!trimmed) {
      children.push(new Paragraph({ children: [] }));
      continue;
    }

    // Headings
    if (trimmed.startsWith("# ")) {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: trimmed.slice(2) })],
      }));
    } else if (trimmed.startsWith("## ")) {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: trimmed.slice(3) })],
      }));
    } else if (trimmed.startsWith("### ")) {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun({ text: trimmed.slice(4) })],
      }));
    }
    // Bullet points
    else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      const text = trimmed.slice(2);
      children.push(new Paragraph({
        bullet: { level: 0 },
        children: parseInlineFormatting(text),
      }));
    }
    // Regular paragraph
    else {
      children.push(new Paragraph({
        children: parseInlineFormatting(trimmed),
      }));
    }
  }

  if (inTable) flushTable();

  return new Document({
    sections: [{ children }],
  });
}

/** Parse **bold** and regular text */
function parseInlineFormatting(text: string): TextRun[] {
  const runs: TextRun[] = [];
  const parts = text.split(/(\*\*[^*]+\*\*)/);
  for (const part of parts) {
    if (part.startsWith("**") && part.endsWith("**")) {
      runs.push(new TextRun({ text: part.slice(2, -2), bold: true, size: 22 }));
    } else {
      runs.push(new TextRun({ text: part, size: 22 }));
    }
  }
  return runs;
}

export const documentRoutes: FastifyPluginAsync = async (app) => {
  // Serve a document as .docx
  app.get<{ Params: { id: string } }>("/documents/:id", async (req, reply) => {
    // Try .md source file
    const baseName = req.params.id.replace(/\.(docx|md|txt)$/, "");
    const mdPath = join(DOCS_DIR, baseName + ".md");
    const txtPath = join(DOCS_DIR, baseName + ".txt");

    let content: string;
    try {
      content = await readFile(mdPath, "utf-8");
    } catch {
      try {
        content = await readFile(txtPath, "utf-8");
      } catch {
        return reply.status(404).send({ error: "Document not found" });
      }
    }

    // Convert to docx
    const doc = mdToDocx(content);
    const buffer = await Packer.toBuffer(doc);

    reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    reply.header("Content-Disposition", `attachment; filename="${baseName}.docx"`);
    return reply.send(buffer);
  });

  // List all documents
  app.get("/documents", async () => {
    const files = await readdir(DOCS_DIR).catch(() => []);
    return files.filter(f => f.endsWith(".md") || f.endsWith(".txt"));
  });
};
