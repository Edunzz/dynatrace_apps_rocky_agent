// Runs Claude Code for one prompt: `claude -p` with stream-json in and out,
// continuing the session's conversation, and feeds its events to the
// translator. One run per session at a time; the session is busy until the
// process exits.

import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import readline from "node:readline";
import { composeSystem } from "./policy.mjs";
import { redactText } from "./redact.mjs";
import { GatewayError } from "./sanitize.mjs";
import { RunTranslator } from "./translate.mjs";

// Variables passed through to Claude Code. Everything else in the gateway
// environment (for example the runtime password) never reaches the agent.
export const PASS_ENV = [
  "PATH",
  "HOME",
  "USER",
  "LANG",
  "LC_ALL",
  "TZ",
  "TMPDIR",
  "DISPLAY",
  "XDG_CONFIG_HOME",
  "WORKSPACE_PATH",
  "DT_PLATFORM_URL",
  "DTCTL_SAFETY_LEVEL",
  "DTCTL_DISABLE_KEYRING",
  "DTCTL_TOKEN_STORAGE",
  // Claude credentials and providers.
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
  "AWS_PROFILE",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_BEARER_TOKEN_BEDROCK",
  "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
  "AWS_CONTAINER_CREDENTIALS_FULL_URI",
  "AWS_CONTAINER_AUTHORIZATION_TOKEN",
  "AWS_WEB_IDENTITY_TOKEN_FILE",
  "AWS_ROLE_ARN",
  "ANTHROPIC_VERTEX_PROJECT_ID",
  "CLOUD_ML_REGION",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "ANTHROPIC_FOUNDRY_RESOURCE",
  "ANTHROPIC_FOUNDRY_BASE_URL",
  "ANTHROPIC_FOUNDRY_API_KEY",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "NODE_EXTRA_CA_CERTS",
  // Windows only (local development of the gateway); unset in the container.
  "SYSTEMROOT",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
];

// Behavior every run gets: no updates, telemetry or auto memory, no CLAUDE.md
// files (the policy arrives through the system prompt), subagents in the
// foreground, and subagent text in the event stream.
const FIXED_ENV = {
  DISABLE_AUTOUPDATER: "1",
  DISABLE_UPDATES: "1",
  DISABLE_TELEMETRY: "1",
  DISABLE_ERROR_REPORTING: "1",
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
  CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1",
  CLAUDE_CODE_FORWARD_SUBAGENT_TEXT: "1",
  MCP_TIMEOUT: "30000",
};

export function buildEnv(config, source = config.claude.sourceEnv ?? process.env) {
  const env = {};
  for (const name of PASS_ENV) {
    if (source[name] !== undefined && source[name] !== "") env[name] = source[name];
  }
  return {
    ...env,
    ...FIXED_ENV,
    CLAUDE_CONFIG_DIR: config.claude.configDir,
    MCP_TOOL_TIMEOUT: String(config.claude.permissionTimeoutMs + 120_000),
    ...(config.claude.subprocessEnvScrub ? { CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1" } : {}),
  };
}

export function buildArgs({ session, config, overlay, mcpConfigFile, options = {} }) {
  const args = [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    // Only user settings (CLAUDE_CONFIG_DIR) and managed settings apply: a
    // repository in the workspace cannot add hooks, env or MCP servers.
    "--setting-sources",
    "user",
    "--strict-mcp-config",
    "--mcp-config",
    mcpConfigFile,
    "--permission-prompt-tool",
    "mcp__rocky__approve",
    "--permission-mode",
    "default",
    "--append-system-prompt-file",
    config.policyFile,
    // Rebuild the system prompt on every run so overlay changes apply.
    "--system-prompt-snapshot",
    "off",
  ];
  const system = composeSystem(overlay);
  if (system) args.push("--append-system-prompt", system);
  // A model chosen for this prompt wins over the runtime's ROCKY_MODEL.
  const model = options.model || config.claude.model;
  if (model) args.push("--model", model);
  if (options.effort) args.push("--effort", options.effort);
  if (config.claude.disallowedTools.length > 0) args.push("--disallowedTools", config.claude.disallowedTools.join(","));
  args.push(...(session.started ? ["--resume", session.claudeSessionId] : ["--session-id", session.claudeSessionId]));
  return args;
}

export function titleFrom(text) {
  const line = text.trim().split(/\r?\n/, 1)[0].replace(/\s+/g, " ");
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

export class ClaudeRunner {
  constructor({ config, store, permissions, logger, audit, onAuthState = () => {}, spawnFn = spawn, now = () => Date.now() }) {
    this.config = config;
    this.store = store;
    this.permissions = permissions;
    this.logger = logger;
    this.audit = audit;
    this.onAuthState = onAuthState;
    this.spawnFn = spawnFn;
    this.now = now;
    this.runs = new Map(); // session ID -> run
    this.internalUrl = null;
  }

  get activeCount() {
    return this.runs.size;
  }

  status(sessionId) {
    const run = this.runs.get(sessionId);
    if (!run) return { type: "idle" };
    return run.translator.retry ?? { type: "busy" };
  }

  statusMap() {
    return Object.fromEntries([...this.runs.keys()].map((id) => [id, this.status(id)]));
  }

  // Used by the loopback permission endpoint.
  findRun(runId) {
    for (const run of this.runs.values()) if (run.id === runId) return run;
    return null;
  }

  async writeRunFiles(run) {
    const dir = join(this.config.stateDir, "runs");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const runFile = join(dir, `${run.id}.json`);
    const mcpFile = join(dir, `${run.id}.mcp.json`);
    const timeoutMs = this.config.claude.permissionTimeoutMs + 60_000;
    await writeFile(runFile, JSON.stringify({ url: this.internalUrl, secret: run.secret, runId: run.id, sessionId: run.sessionId, timeoutMs }), {
      mode: 0o600,
    });
    const server = { type: "stdio", command: this.config.claude.nodeBin, args: [this.config.claude.permissionHelper, runFile] };
    await writeFile(mcpFile, JSON.stringify({ mcpServers: { rocky: server } }), { mode: 0o600 });
    run.files = [runFile, mcpFile];
    return mcpFile;
  }

  async prompt(session, text, overlay, options = {}) {
    if (this.runs.has(session.id)) {
      throw new GatewayError(409, "session_busy", "The agent is still working on this session. Wait for it or stop it first.");
    }
    if (this.runs.size >= this.config.claude.maxConcurrentRuns) {
      throw new GatewayError(429, "too_many_runs", "This runtime is busy with other sessions. Try again in a moment.");
    }
    const now = this.now();
    const userMessage = {
      info: { id: `msg_user_${randomUUID()}`, sessionID: session.id, role: "user", time: { created: now } },
      parts: [],
    };
    userMessage.parts.push({ id: `prt_${userMessage.info.id.slice(4)}_0`, sessionID: session.id, messageID: userMessage.info.id, type: "text", text });
    session.messages.push(userMessage);
    if (!session.title) session.title = titleFrom(text);
    session.time.updated = now;

    const run = {
      id: randomBytes(8).toString("hex"),
      secret: randomBytes(24).toString("hex"),
      sessionId: session.id,
      session,
      translator: new RunTranslator(session, { now: this.now }),
      resumed: session.started,
      startedAt: now,
      aborted: false,
      ended: false,
      stderr: "",
      files: [],
      timers: [],
    };
    this.runs.set(session.id, run);
    this.store.save(session.id);
    try {
      const mcpFile = await this.writeRunFiles(run);
      const args = buildArgs({ session, config: this.config, overlay, mcpConfigFile: mcpFile, options });
      run.child = this.spawnFn(this.config.claude.bin, [...this.config.claude.binArgs, ...args], {
        cwd: this.config.workspacePath,
        env: buildEnv(this.config),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      await this.end(run, { spawnError: String(error?.message ?? error) });
      return userMessage;
    }
    const child = run.child;
    child.on("error", (error) => void this.end(run, { spawnError: String(error?.message ?? error) }));
    child.on("close", (code, signal) => void this.end(run, { code, signal }));
    readline.createInterface({ input: child.stdout }).on("line", (line) => this.onLine(run, line));
    child.stderr.on("data", (chunk) => {
      run.stderr = (run.stderr + chunk.toString("utf8")).slice(-4000);
    });
    child.stdin.on("error", () => {});
    child.stdin.end(`${JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } })}\n`);
    run.timers.push(setTimeout(() => this.abort(session.id, "timeout"), this.config.claude.runTimeoutMs));
    await this.audit("session.prompt", { sessionID: session.id, runId: run.id, promptChars: text.length, resumed: run.resumed });
    return userMessage;
  }

  onLine(run, line) {
    if (!line.trim()) return;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    const changed = run.translator.handle(event);
    if (run.translator.authFailed && !run.authReported) {
      run.authReported = true;
      this.onAuthState("failed");
    }
    if (changed) {
      run.session.time.updated = this.now();
      this.store.save(run.sessionId);
    }
  }

  abort(sessionId, reason = "user") {
    const run = this.runs.get(sessionId);
    if (!run) return false;
    run.aborted = true;
    run.abortReason = reason;
    this.permissions.cancelRun(run.id, reason === "timeout" ? "The run took too long and was stopped." : "Stopped by the user.");
    const child = run.child;
    if (child && child.exitCode === null) {
      // SIGINT ends the turn cleanly; escalate if Claude Code does not exit.
      child.kill("SIGINT");
      run.timers.push(setTimeout(() => child.exitCode === null && child.kill("SIGTERM"), 5_000));
      run.timers.push(setTimeout(() => child.exitCode === null && child.kill("SIGKILL"), 10_000));
    }
    return true;
  }

  abortAll() {
    for (const id of [...this.runs.keys()]) this.abort(id, "shutdown");
  }

  async end(run, { code = 0, signal = null, spawnError = null }) {
    if (run.ended) return;
    run.ended = true;
    for (const timer of run.timers) clearTimeout(timer);
    this.permissions.cancelRun(run.id, "The agent run ended.");
    const { translator, session } = run;
    translator.finish({ code, signal, aborted: run.aborted, spawnError });
    // A conversation that cannot be resumed (for example a lost transcript)
    // starts fresh on the next message instead of failing forever.
    if (run.resumed && !spawnError && !run.aborted && translator.result === null && code !== 0) {
      session.started = false;
    }
    if (translator.result && !translator.result.isError && !translator.authFailed) this.onAuthState("ok");
    session.time.updated = this.now();
    this.runs.delete(run.sessionId);
    await Promise.all(run.files.map((file) => rm(file, { force: true })));
    if (this.store.has(session.id)) await this.store.save(session.id, { immediate: true });
    if ((code !== 0 || spawnError) && run.stderr) {
      this.logger.warn("claude stderr", { sessionID: session.id, runId: run.id, stderr: redactText(run.stderr.slice(-1500)) });
    }
    await this.audit("session.run.finished", {
      sessionID: session.id,
      runId: run.id,
      exitCode: code,
      signal,
      aborted: run.aborted,
      abortReason: run.abortReason ?? null,
      error: Boolean(spawnError) || Boolean(translator.result?.isError),
      durationMs: this.now() - run.startedAt,
    });
  }
}
