import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";

export function readCsv<T>(filePath: string): T[] {
  const content = readFileSync(filePath, "utf-8");
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as T[];
}
