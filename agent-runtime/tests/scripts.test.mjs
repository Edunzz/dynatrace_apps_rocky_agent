import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { composeConfig, resolveModel } from "../scripts/compose-opencode-config.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const scripts = join(here, "..", "scripts");
const hasJq = spawnSync("jq", ["--version"]).status === 0;

const TOKEN = `dt0s16.ABCDEFGH12345678.${"B".repeat(64)}`;
const VALID = {
  NODE_ENV: "production",
  DT_PLATFORM_URL: "https://abc12345.apps.dynatrace.com",
  DT_PLATFORM_TOKEN: TOKEN,
  OPENCODE_SERVER_PASSWORD: "a-unique-password-123",
};

function run(script, env, args = []) {
  const result = spawnSync("bash", [join(scripts, script), ...args], {
    env: { PATH: process.env.PATH, ...env },
    encoding: "utf8",
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

describe("validate-environment.sh", () => {
  it("accepts a valid production environment", () => {
    const r = run("validate-environment.sh", VALID);
    assert.equal(r.status, 0, r.out);
  });

  it("never prints secret values", () => {
    const r = run("validate-environment.sh", { ...VALID, ANTHROPIC_API_KEY: "sk-ant-should-not-appear-123456", OPENCODE_PROVIDER: "anthropic" });
    assert.doesNotMatch(r.out, /a-unique-password-123/);
    assert.doesNotMatch(r.out, new RegExp(TOKEN.replace(/\./g, "\\.")));
    assert.doesNotMatch(r.out, /sk-ant-should-not-appear/);
    assert.match(r.out, /DT_PLATFORM_TOKEN\s+\[REDACTED\]/);
  });

  for (const [name, env, message] of [
    ["missing DT_PLATFORM_URL", { DT_PLATFORM_URL: "" }, /DT_PLATFORM_URL is required/],
    ["missing DT_PLATFORM_TOKEN", { DT_PLATFORM_TOKEN: "" }, /DT_PLATFORM_TOKEN is required/],
    ["missing password", { OPENCODE_SERVER_PASSWORD: "" }, /OPENCODE_SERVER_PASSWORD is required/],
    ["http platform URL", { DT_PLATFORM_URL: "http://abc12345.apps.dynatrace.com" }, /HTTPS origin/],
    ["URL with credentials", { DT_PLATFORM_URL: "https://u:p@abc12345.apps.dynatrace.com" }, /must not contain credentials/],
    ["classic API URL", { DT_PLATFORM_URL: "https://abc12345.live.dynatrace.com" }, /classic API domain/],
    ["default password in production", { OPENCODE_SERVER_PASSWORD: "edunzzxgundam79" }, /development default/],
    ["short password in production", { OPENCODE_SERVER_PASSWORD: "short-pass" }, /at least 16 characters/],
    ["wildcard CORS in production", { ALLOWED_ORIGINS: "*" }, /not allowed in production/],
    ["http origin in production", { ALLOWED_ORIGINS: "http://example.com" }, /must be an https:\/\/ origin/],
    ["unrestricted dtctl safety level", { DTCTL_SAFETY_LEVEL: "dangerously-unrestricted" }, /not allowed/],
    ["invalid NODE_ENV", { NODE_ENV: "staging" }, /NODE_ENV must be/],
    ["token with newline", { DT_PLATFORM_TOKEN: "dt0s16.abc\ninjected: true" }, /unexpected format/],
  ]) {
    it(`rejects ${name}`, () => {
      const r = run("validate-environment.sh", { ...VALID, ...env });
      assert.equal(r.status, 1, r.out);
      assert.match(r.out, message);
    });
  }

  it("allows the default password in development with a warning", () => {
    const r = run("validate-environment.sh", { ...VALID, NODE_ENV: "development", OPENCODE_SERVER_PASSWORD: "edunzzxgundam79" });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /\[WARN\].*development default/);
  });

  it("flags a missing provider credential as authentication required", () => {
    const r = run("validate-environment.sh", { ...VALID, OPENCODE_MODEL: "anthropic/claude-sonnet-4-5" });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /ANTHROPIC_API_KEY is not set \(authentication required\)/);
  });
});

describe("validate-dynatrace.sh", { skip: !hasJq && "jq is not installed" }, () => {
  it("reports degraded mode without failing hard when dtctl is unavailable", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "rocky-dt-"));
    const r = run("validate-dynatrace.sh", {
      ROCKY_STATE_DIR: stateDir,
      DT_PLATFORM_URL: "https://abc12345.apps.dynatrace.com",
      PATH: process.env.PATH.split(process.platform === "win32" ? ";" : ":")
        .filter((p) => !/dtctl/i.test(p))
        .join(process.platform === "win32" ? ";" : ":"),
    });
    assert.equal(r.status, 1);
    const status = JSON.parse(readFileSync(join(stateDir, "dynatrace-status.json"), "utf8"));
    assert.equal(status.status, "unavailable");
    assert.equal(status.dtctlInstalled, false);
    assert.equal(status.environmentHost, "abc12345.apps.dynatrace.com");
  });

  it("reports not_configured without a platform URL", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "rocky-dt-"));
    run("validate-dynatrace.sh", { ROCKY_STATE_DIR: stateDir });
    const status = JSON.parse(readFileSync(join(stateDir, "dynatrace-status.json"), "utf8"));
    assert.equal(status.status, "not_configured");
  });
});

describe("configure-dtctl.sh", () => {
  it("writes a 0600 config with the token reference and no token in output", () => {
    const home = mkdtempSync(join(tmpdir(), "rocky-home-"));
    const r = run("configure-dtctl.sh", { ...VALID, HOME: home, XDG_CONFIG_HOME: join(home, ".config"), DTCTL_SAFETY_LEVEL: "readonly" });
    assert.equal(r.status, 0, r.out);
    assert.doesNotMatch(r.out, /dt0s16/);
    const config = readFileSync(join(home, ".config", "dtctl", "config"), "utf8");
    assert.match(config, /current-context: rocky/);
    assert.match(config, /safety-level: readonly/);
    assert.match(config, /token-ref: rocky-platform-token/);
    assert.match(config, new RegExp(`token: '${TOKEN.replace(/\./g, "\\.")}'`));
  });

  it("refuses values that could inject YAML", () => {
    const home = mkdtempSync(join(tmpdir(), "rocky-home-"));
    const r = run("configure-dtctl.sh", { ...VALID, HOME: home, DT_PLATFORM_TOKEN: "abc'\ncontexts: []" });
    assert.equal(r.status, 1);
  });
});

describe("compose-opencode-config", () => {
  const baseline = JSON.parse(readFileSync(join(here, "..", "opencode.json"), "utf8"));

  it("applies the model and keeps the protected keys", () => {
    const { config } = composeConfig(baseline, null, {
      OPENCODE_MODEL: "claude-sonnet-4-5",
      OPENCODE_PROVIDER: "anthropic",
      ROCKY_POLICY_FILE: "/opt/rocky/policy/AGENTS.md",
    });
    assert.equal(config.model, "anthropic/claude-sonnet-4-5");
    assert.deepEqual(config.instructions, ["/opt/rocky/policy/AGENTS.md"]);
    assert.deepEqual(config.permission, baseline.permission);
    assert.equal(config.share, "disabled");
    assert.equal(config.$schema, undefined);
  });

  it("ignores attempts to weaken permissions through extra configuration", () => {
    const { config, warnings } = composeConfig(
      baseline,
      {
        permission: { bash: "allow" },
        instructions: [],
        share: "auto",
        provider: { mock: { npm: "@ai-sdk/openai-compatible" } },
        agent: { build: { permission: { bash: "allow" }, model: "mock/m" } },
      },
      {},
    );
    assert.deepEqual(config.permission, baseline.permission);
    assert.deepEqual(config.instructions, baseline.instructions);
    assert.equal(config.share, "disabled");
    assert.ok(config.provider.mock);
    assert.deepEqual(config.agent.build, { model: "mock/m" });
    assert.ok(warnings.length >= 3);
  });

  it("asks before any bash command that is not explicitly read-only", () => {
    assert.equal(baseline.permission.bash["*"], "ask");
    for (const allowed of Object.entries(baseline.permission.bash).filter(([, v]) => v === "allow").map(([k]) => k)) {
      assert.doesNotMatch(allowed, /\b(rm|delete|apply -f(?!.*dry-run)|kubectl|terraform|git push|curl|wget)\b/, allowed);
    }
    assert.equal(baseline.permission.bash["printenv*"], "deny");
    assert.equal(baseline.permission.edit["*"], "ask");
    assert.equal(baseline.share, "disabled");
  });

  it("resolves provider-less model names", () => {
    assert.equal(resolveModel("gpt-5", "openai"), "openai/gpt-5");
    assert.equal(resolveModel("anthropic/x", "openai"), "anthropic/x");
    assert.equal(resolveModel("", "openai"), undefined);
  });
});

describe("Dockerfile", () => {
  const dockerfile = readFileSync(join(here, "..", "Dockerfile"), "utf8");

  it("runs as a non-root user", () => {
    assert.match(dockerfile, /^USER 10001:10001$/m);
  });

  it("never bakes secrets into build arguments or layers", () => {
    assert.doesNotMatch(dockerfile, /ARG\s+(DT_PLATFORM_TOKEN|OPENCODE_SERVER_PASSWORD|\w*API_KEY|AWS_SECRET)/);
    assert.doesNotMatch(dockerfile, /ENV\s+(DT_PLATFORM_TOKEN|OPENCODE_SERVER_PASSWORD|\w*API_KEY)/);
  });

  it("pins the base image by digest and tools by version", () => {
    assert.match(dockerfile, /ARG NODE_IMAGE=node:\d+\.\d+\.\d+-bookworm-slim@sha256:[0-9a-f]{64}/);
    assert.match(dockerfile, /ARG OPENCODE_VERSION=\d+\.\d+\.\d+/);
    assert.match(dockerfile, /ARG DTCTL_VERSION=\d+\.\d+\.\d+/);
    assert.match(dockerfile, /ARG DT_SKILLS_REF=[0-9a-f]{40}/);
    assert.match(dockerfile, /ARG RCA_SKILLS_REF=[0-9a-f]{40}/);
  });

  it("exposes the API port and defines a health check", () => {
    assert.match(dockerfile, /^EXPOSE 4096$/m);
    assert.match(dockerfile, /^HEALTHCHECK .*healthcheck\.sh/m);
  });
});

describe("healthcheck.sh", () => {
  it("does not pass credentials as arguments", () => {
    const script = readFileSync(join(here, "..", "healthcheck.sh"), "utf8");
    assert.doesNotMatch(script, /curl[^\n]*\s-u\s/);
    assert.match(script, /-K -/);
  });
});
