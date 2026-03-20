import { type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawnClaude, NdjsonParser } from "@anagnole/claude-cli-wrapper";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT_PATH = path.join(__dirname, "system-prompt.md");
const MCP_CONFIG_PATH = path.join(__dirname, "mcp-config.json");
const PROJECT_DIR = path.resolve(__dirname, "../..");

interface StreamEvent {
  type: string;
  event: {
    type: string;
    delta?: { type: string; text?: string; partial_json?: string };
    content_block?: { type: string; name?: string; id?: string };
    index?: number;
    [key: string]: unknown;
  };
  session_id?: string;
}

export type TextCallback = (text: string) => void;
export type StatusCallback = (
  status: "ready" | "thinking" | "error",
) => void;
export type ToolUseCallback = (
  tool: string,
  input: Record<string, unknown>,
) => void;
export type ToolResultCallback = (tool: string, data: unknown) => void;

export class ClaudeProcess {
  private proc: ChildProcess | null = null;
  private stderrRl: import("node:readline").Interface | null = null;
  private textListeners = new Set<TextCallback>();
  private statusListeners = new Set<StatusCallback>();
  private toolUseListeners = new Set<ToolUseCallback>();
  private toolResultListeners = new Set<ToolResultCallback>();
  private sessionId: string | null = null;
  private systemPrompt: string;
  private busy = false;

  // Track active tool calls by content block index
  private activeTools = new Map<
    number,
    { name: string; inputJson: string }
  >();

  constructor() {
    this.systemPrompt = readFileSync(SYSTEM_PROMPT_PATH, "utf-8");
  }

  get isReady(): boolean {
    return !this.busy;
  }

  get isBusy(): boolean {
    return this.busy;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  send(message: string): void {
    if (this.busy) throw new Error("Assistant is still thinking");
    this.runMessage(message);
  }

  private runMessage(message: string): void {
    this.busy = true;
    this.activeTools.clear();
    this.emitStatus("thinking");

    this.proc = spawnClaude({
      prompt: message,
      streaming: true,
      systemPrompt: this.systemPrompt,
      permissionMode: "bypassPermissions",
      mcpConfig: MCP_CONFIG_PATH,
      strictMcpConfig: true,
      resumeSessionId: this.sessionId ?? undefined,
      workingDirectory: PROJECT_DIR,
      claudePath: process.env.CLAUDE_PATH,
    });

    const parser = new NdjsonParser();

    this.proc.stdout!.on("data", (chunk: Buffer) => {
      for (const raw of parser.feed(chunk.toString())) {
        this.handleEvent(raw as StreamEvent);
      }
    });

    this.stderrRl = createInterface({ input: this.proc.stderr! });
    this.stderrRl.on("line", (line) => {
      console.error("[ehr stderr]", line);
    });

    this.proc.on("exit", (code) => {
      for (const raw of parser.flush()) {
        this.handleEvent(raw as StreamEvent);
      }
      this.cleanup();
      this.proc = null;
      this.busy = false;
      this.emitStatus(code === 0 ? "ready" : "error");
    });

    this.proc.on("error", (err) => {
      console.error("[ehr] spawn error:", err);
      this.cleanup();
      this.proc = null;
      this.busy = false;
      this.emitStatus("error");
    });
  }

  private handleEvent(event: StreamEvent): void {
    // Capture session ID
    if (!this.sessionId && event.session_id) {
      this.sessionId = event.session_id;
    }

    const ev = event.event;
    if (!ev) return;

    // Text deltas
    if (ev.delta?.type === "text_delta" && ev.delta.text) {
      this.emitText(ev.delta.text);
    }

    // Tool use: content_block_start with tool_use block
    if (
      ev.type === "content_block_start" &&
      ev.content_block?.type === "tool_use" &&
      ev.content_block.name
    ) {
      const idx = ev.index ?? 0;
      this.activeTools.set(idx, {
        name: ev.content_block.name,
        inputJson: "",
      });
    }

    // Tool use: accumulate partial JSON input
    if (ev.delta?.type === "input_json_delta" && ev.delta.partial_json) {
      const idx = ev.index ?? 0;
      const tool = this.activeTools.get(idx);
      if (tool) {
        tool.inputJson += ev.delta.partial_json;
      }
    }

    // Tool use: content_block_stop — emit the tool_use event
    if (ev.type === "content_block_stop") {
      const idx = ev.index ?? 0;
      const tool = this.activeTools.get(idx);
      if (tool) {
        try {
          const input = JSON.parse(tool.inputJson || "{}");
          this.emitToolUse(tool.name, input);
        } catch {
          this.emitToolUse(tool.name, {});
        }
        this.activeTools.delete(idx);
      }
    }

    // Tool result: content_block_start with tool_result
    if (
      ev.type === "content_block_start" &&
      ev.content_block?.type === "tool_result"
    ) {
      // Tool results come as text in subsequent deltas — we handle them
      // by tracking which tool just completed. The result text appears
      // as content_block_delta with type text after a tool_result block.
    }
  }

  onText(cb: TextCallback): () => void {
    this.textListeners.add(cb);
    return () => this.textListeners.delete(cb);
  }

  onStatus(cb: StatusCallback): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  onToolUse(cb: ToolUseCallback): () => void {
    this.toolUseListeners.add(cb);
    return () => this.toolUseListeners.delete(cb);
  }

  onToolResult(cb: ToolResultCallback): () => void {
    this.toolResultListeners.add(cb);
    return () => this.toolResultListeners.delete(cb);
  }

  private emitText(text: string): void {
    for (const cb of this.textListeners) cb(text);
  }

  private emitStatus(status: "ready" | "thinking" | "error"): void {
    for (const cb of this.statusListeners) cb(status);
  }

  private emitToolUse(
    tool: string,
    input: Record<string, unknown>,
  ): void {
    for (const cb of this.toolUseListeners) cb(tool, input);
  }

  private cleanup(): void {
    if (this.stderrRl) {
      this.stderrRl.close();
      this.stderrRl = null;
    }
  }

  stop(): void {
    if (this.proc) {
      this.proc.kill("SIGTERM");
      this.proc = null;
    }
    this.cleanup();
    this.textListeners.clear();
    this.statusListeners.clear();
    this.toolUseListeners.clear();
    this.toolResultListeners.clear();
    this.busy = false;
  }
}

let instance: ClaudeProcess | null = null;

export function getClaudeProcess(): ClaudeProcess {
  if (!instance) {
    instance = new ClaudeProcess();
  }
  return instance;
}
