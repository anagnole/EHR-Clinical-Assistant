import { type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  spawnClaude,
  NdjsonParser,
  ProviderRegistry,
  ClaudeCliProvider,
  OllamaProvider,
  type Provider,
} from "@anagnole/claude-cli-wrapper";
import { TOOL_DEFS, executeTool } from "./tools.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT_PATH = path.join(__dirname, "system-prompt.md");
const SYSTEM_PROMPT_NOTOOLS_PATH = path.join(__dirname, "system-prompt-notools.md");
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
export type ModelChangeCallback = (model: string) => void;

// Build provider registry
const registry = new ProviderRegistry();
registry.register(new ClaudeCliProvider({
  claudePath: process.env.CLAUDE_PATH,
}));
registry.register(new OllamaProvider({
  baseUrl: process.env.OLLAMA_URL ?? "http://localhost:11434",
}));

export { registry };

export class ClaudeProcess {
  private proc: ChildProcess | null = null;
  private cancelOllama: (() => void) | null = null;
  private stderrRl: import("node:readline").Interface | null = null;
  private textListeners = new Set<TextCallback>();
  private statusListeners = new Set<StatusCallback>();
  private toolUseListeners = new Set<ToolUseCallback>();
  private toolResultListeners = new Set<ToolResultCallback>();
  private modelChangeListeners = new Set<ModelChangeCallback>();
  private sessionId: string | null = null;
  private systemPrompt: string;
  private busy = false;
  private currentModel = "claude-sonnet-4-6";

  // Track active tool calls by content block index
  private activeTools = new Map<
    number,
    { name: string; inputJson: string }
  >();

  private systemPromptTools: string;
  private systemPromptNoTools: string;

  constructor() {
    this.systemPromptTools = readFileSync(SYSTEM_PROMPT_PATH, "utf-8");
    this.systemPromptNoTools = readFileSync(SYSTEM_PROMPT_NOTOOLS_PATH, "utf-8");
    this.systemPrompt = this.systemPromptTools;
  }

  get isReady(): boolean {
    return !this.busy;
  }

  get isBusy(): boolean {
    return this.busy;
  }

  get model(): string {
    return this.currentModel;
  }

  setModel(model: string): void {
    if (this.busy) throw new Error("Cannot change model while assistant is thinking");
    const provider = registry.resolve(model);
    if (!provider) throw new Error(`No provider found for model: ${model}`);
    this.currentModel = model;
    // All models now get the full system prompt since Ollama models have tool access too
    this.systemPrompt = this.systemPromptTools;
    for (const cb of this.modelChangeListeners) cb(model);
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  send(message: string): void {
    if (this.busy) throw new Error("Assistant is still thinking");

    const provider = registry.resolve(this.currentModel);
    if (!provider) throw new Error(`No provider for model: ${this.currentModel}`);

    if (provider.name === "claude-cli") {
      this.runViaCli(message);
    } else {
      this.runViaProvider(message, provider);
    }
  }

  /** Existing Claude CLI path — supports MCP tools, sessions, etc. */
  private runViaCli(message: string): void {
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

  /** Provider-based path (Ollama, etc.) — agent loop with tool calling. */
  private runViaProvider(message: string, _provider: Provider): void {
    this.busy = true;
    this.activeTools.clear();
    this.emitStatus("thinking");

    const ollamaUrl = process.env.OLLAMA_URL ?? "http://localhost:11434";
    const controller = new AbortController();
    this.cancelOllama = () => controller.abort();

    const messages: Array<Record<string, unknown>> = [
      { role: "system", content: this.systemPrompt },
      { role: "user", content: message },
    ];

    const MAX_TOOL_ROUNDS = 10;

    const ollamaChat = async (body: Record<string, unknown>) => {
      const res = await fetch(`${ollamaUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Ollama error (${res.status}): ${text}`);
      }
      return res;
    };

    const run = async () => {
      let useTools = true;

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const body: Record<string, unknown> = {
          model: this.currentModel,
          messages,
          stream: false,
          options: { num_predict: 4096 },
        };

        if (useTools) {
          body.tools = TOOL_DEFS;
        }

        let res: Response;
        try {
          res = await ollamaChat(body);
        } catch (err) {
          // If model doesn't support tools, retry without them
          const msg = (err as Error).message;
          if (useTools && msg.includes("does not support tools")) {
            console.log(`[ehr] ${this.currentModel} does not support native tools, running without`);
            useTools = false;
            delete body.tools;
            res = await ollamaChat(body);
          } else {
            throw err;
          }
        }

        const data = await res.json() as {
          message: {
            role: string;
            content: string;
            tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
          };
        };

        const toolCalls = data.message.tool_calls;
        if (!toolCalls || toolCalls.length === 0) {
          // No tool calls — model gave a final text response, stream it out
          if (data.message.content) {
            this.emitText(data.message.content);
          }
          return;
        }

        // Add assistant message with tool calls to history
        messages.push(data.message);

        // Execute each tool call
        for (const tc of toolCalls) {
          const toolName = tc.function.name;
          const toolArgs = tc.function.arguments;

          console.log(`[ehr tool] ${toolName}(${JSON.stringify(toolArgs).slice(0, 200)})`);
          this.emitToolUse(toolName, toolArgs);

          const result = await executeTool(toolName, toolArgs);

          messages.push({
            role: "tool",
            content: JSON.stringify(result),
          });
        }
        // Loop continues — send tool results back to model
      }
    };

    run()
      .then(() => {
        this.cancelOllama = null;
        this.busy = false;
        this.emitStatus("ready");
      })
      .catch((err) => {
        if ((err as Error).name === "AbortError") return;
        console.error("[ehr] provider error:", err);
        this.cancelOllama = null;
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

    // Log non-text events for debugging
    if (ev.type !== "content_block_delta" || ev.delta?.type !== "text_delta") {
      console.log("[ehr event]", ev.type, ev.content_block?.type ?? "", ev.delta?.type ?? "",
        ev.content_block?.name ? `name=${ev.content_block.name}` : "",
        JSON.stringify(ev).slice(0, 200));
    }

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
      // Tool results come as text in subsequent deltas
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

  onModelChange(cb: ModelChangeCallback): () => void {
    this.modelChangeListeners.add(cb);
    return () => this.modelChangeListeners.delete(cb);
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
    if (this.cancelOllama) {
      this.cancelOllama();
      this.cancelOllama = null;
    }
    this.cleanup();
    this.textListeners.clear();
    this.statusListeners.clear();
    this.toolUseListeners.clear();
    this.toolResultListeners.clear();
    this.modelChangeListeners.clear();
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
