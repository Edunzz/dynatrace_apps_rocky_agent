import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const scripts = join(here, "..", "scripts");
const hasJq = spawnSync("jq", ["--version"]).status === 0;

const TOKEN = `dt0s16.ABCDEFGH12345678.${"B".repeat(64)}`;
const VALID = {
  NODE_ENV: "production",
  HOME: mkdtempSync(join(tmpdir(), "rocky-validate-")),
  DT_PLATFORM_URL: "https://abc12345.apps.dynatrace.com",
  DT_PLATFORM_TOKEN: TOKEN,
  ROCKY_SERVER_PASSWORD: "a-unique-password-123",
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
    const r = run("validate-environment.sh", {
      ...VALID,
      ANTHROPIC_API_KEY: "sk-ant-should-not-appear-123456",
      CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-should-not-appear",
    });
    assert.doesNotMatch(r.out, /a-unique-password-123/);
    assert.doesNotMatch(r.out, new RegExp(TOKEN.replace(/\./g, "\\.")));
    assert.doesNotMatch(r.out, /should-not-appear/);
    assert.match(r.out, /DT_PLATFORM_TOKEN\s+\[REDACTED\]/);
    assert.match(r.out, /CLAUDE_CODE_OAUTH_TOKEN\s+\[REDACTED\]/);
  });

  for (const [name, env, message] of [
    ["missing DT_PLATFORM_URL", { DT_PLATFORM_URL: "" }, /DT_PLATFORM_URL is required/],
    ["missing DT_PLATFORM_TOKEN", { DT_PLATFORM_TOKEN: "" }, /DT_PLATFORM_TOKEN is required/],
    ["missing password", { ROCKY_SERVER_PASSWORD: "" }, /ROCKY_SERVER_PASSWORD is required/],
    ["http platform URL", { DT_PLATFORM_URL: "http://abc12345.apps.dynatrace.com" }, /HTTPS origin/],
    ["URL with credentials", { DT_PLATFORM_URL: "https://u:p@abc12345.apps.dynatrace.com" }, /must not contain credentials/],
    ["classic API URL", { DT_PLATFORM_URL: "https://abc12345.live.dynatrace.com" }, /classic API domain/],
    ["default password in production", { ROCKY_SERVER_PASSWORD: "edunzzxgundam79" }, /development default/],
    ["short password in production", { ROCKY_SERVER_PASSWORD: "short-pass" }, /at least 16 characters/],
    ["wildcard CORS in production", { ALLOWED_ORIGINS: "*" }, /not allowed in production/],
    ["http origin in production", { ALLOWED_ORIGINS: "http://example.com" }, /must be an https:\/\/ origin/],
    ["unrestricted dtctl safety level", { DTCTL_SAFETY_LEVEL: "dangerously-unrestricted" }, /not allowed/],
    ["invalid NODE_ENV", { NODE_ENV: "staging" }, /NODE_ENV must be/],
    ["token with newline", { DT_PLATFORM_TOKEN: "dt0s16.abc\ninjected: true" }, /unexpected format/],
    ["invalid model name", { ROCKY_MODEL: "sonnet; rm -rf /" }, /ROCKY_MODEL has an invalid format/],
  ]) {
    it(`rejects ${name}`, () => {
      const r = run("validate-environment.sh", { ...VALID, ...env });
      assert.equal(r.status, 1, r.out);
      assert.match(r.out, message);
    });
  }

  it("allows the default password in development with a warning", () => {
    const r = run("validate-environment.sh", { ...VALID, NODE_ENV: "development", ROCKY_SERVER_PASSWORD: "edunzzxgundam79" });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /\[WARN\].*development default/);
  });

  it("warns, without failing, when Claude is not signed in", () => {
    const r = run("validate-environment.sh", VALID);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /\[WARN\] Claude is not signed in: run 'docker compose run --rm rocky-agent login'/);
  });

  it("accepts each way of signing in to Claude", () => {
    for (const env of [{ CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-x" }, { ANTHROPIC_API_KEY: "sk-ant-api03-x" }, { CLAUDE_CODE_USE_BEDROCK: "1" }]) {
      const r = run("validate-environment.sh", { ...VALID, ...env });
      assert.match(r.out, /\[OK\]   Claude: /, JSON.stringify(env));
    }
  });

  it("accepts model aliases and full names", () => {
    for (const model of ["sonnet", "opus", "claude-sonnet-5-5", "sonnet[1m]"]) {
      const r = run("validate-environment.sh", { ...VALID, ROCKY_MODEL: model });
      assert.equal(r.status, 0, `${model}: ${r.out}`);
    }
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

describe("Claude Code managed settings", () => {
  const settings = JSON.parse(readFileSync(join(here, "..", "claude", "managed-settings.json"), "utf8"));
  const { allow, deny } = settings.permissions;

  it("is the only source of permission rules and hooks, and blocks bypass mode", () => {
    assert.equal(settings.allowManagedPermissionRulesOnly, true);
    assert.equal(settings.allowManagedHooksOnly, true);
    assert.equal(settings.permissions.disableBypassPermissionsMode, "disable");
    assert.equal(settings.permissions.defaultMode, "default");
  });

  it("allows only read-only commands and writes to artifact folders", () => {
    for (const rule of allow) {
      assert.match(rule, /^(Read\(~\/\.claude\/skills\/\*\*\)|Bash\((dtctl|python3?|node) |Edit\(\/\/workspace\/(artifacts|rca|rca-\*)\/\*\*\))/, rule);
      assert.doesNotMatch(rule, /\b(rm|delete|kubectl|terraform|git push|curl|wget)\b/, rule);
    }
    assert.ok(allow.includes("Bash(dtctl apply * --dry-run*)"));
    assert.ok(!allow.some((rule) => /^Bash\(dtctl apply(?!.*dry-run)/.test(rule)));
  });

  it("protects credentials, runtime state and the environment", () => {
    for (const rule of [
      "Read(~/.claude/.credentials.json)",
      "Read(~/.config/dtctl/**)",
      "Read(//proc/**)",
      "Read(~/.rocky/**)",
      "Read(//tmp/rocky/**)",
      "Edit(~/.claude/**)",
      "Bash(env)",
      "Bash(printenv *)",
      "Bash(claude *)",
    ]) {
      assert.ok(deny.includes(rule), rule);
    }
    assert.equal(settings.env.DISABLE_UPDATES, "1");
  });

  it("keeps credentials in the environment out of reach of commands", () => {
    for (const name of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "AWS_SECRET_ACCESS_KEY"]) {
      assert.ok(deny.includes(`Bash(*${name}*)`), name);
    }
    assert.ok(deny.includes("Bash(*/environ*)"));
    assert.equal(settings.permissions.blockReadsOutsideWorkingDirectories, true);
    assert.deepEqual(settings.permissions.additionalDirectories, ["/home/rocky/.claude/skills"]);
  });
});

describe("Dockerfile", () => {
  const dockerfile = readFileSync(join(here, "..", "Dockerfile"), "utf8");

  it("runs as a non-root user", () => {
    assert.match(dockerfile, /^USER 10001:10001$/m);
  });

  it("never bakes secrets into build arguments or layers", () => {
    assert.doesNotMatch(dockerfile, /ARG\s+(DT_PLATFORM_TOKEN|ROCKY_SERVER_PASSWORD|CLAUDE_CODE_OAUTH_TOKEN|\w*API_KEY|AWS_SECRET)/);
    assert.doesNotMatch(dockerfile, /ENV\s+(DT_PLATFORM_TOKEN|ROCKY_SERVER_PASSWORD|CLAUDE_CODE_OAUTH_TOKEN|\w*API_KEY)/);
  });

  it("pins the base image by digest and tools by version and checksum", () => {
    assert.match(dockerfile, /ARG NODE_IMAGE=node:\d+\.\d+\.\d+-bookworm-slim@sha256:[0-9a-f]{64}/);
    assert.match(dockerfile, /ARG CLAUDE_CODE_VERSION=\d+\.\d+\.\d+/);
    assert.match(dockerfile, /ARG CLAUDE_CODE_SHA256_AMD64=[0-9a-f]{64}/);
    assert.match(dockerfile, /ARG CLAUDE_CODE_SHA256_ARM64=[0-9a-f]{64}/);
    assert.match(dockerfile, /ARG DTCTL_VERSION=\d+\.\d+\.\d+/);
    assert.match(dockerfile, /ARG DT_SKILLS_REF=[0-9a-f]{40}/);
    assert.match(dockerfile, /ARG RCA_SKILLS_REF=[0-9a-f]{40}/);
    assert.doesNotMatch(dockerfile, /opencode/i);
  });

  it("installs the managed settings where Claude Code reads them on Linux", () => {
    assert.match(dockerfile, /^COPY claude\/managed-settings\.json \/etc\/claude-code\/managed-settings\.json$/m);
  });

  it("exposes the API port and defines a health check", () => {
    assert.match(dockerfile, /^EXPOSE 4096$/m);
    assert.match(dockerfile, /^HEALTHCHECK .*healthcheck\.sh/m);
  });
});

describe("install-claude-code.sh", () => {
  const script = readFileSync(join(scripts, "install-claude-code.sh"), "utf8");

  it("verifies the signed manifest and the binary checksum", () => {
    assert.match(script, /FINGERPRINT="31DDDE24DDFAB679F42D7BD2BAA929FF1A7ECACE"/);
    assert.match(script, /VALIDSIG \$\{FINGERPRINT\}/);
    assert.match(script, /checksum mismatch against the signed manifest/);
    assert.doesNotMatch(script, /install\.sh|\| *bash/, "no remote installer script is executed");
  });
});

describe("healthcheck.sh", () => {
  it("checks liveness without credentials", () => {
    const script = readFileSync(join(here, "..", "healthcheck.sh"), "utf8");
    assert.match(script, /\/rocky\/v1\/livez/);
    assert.doesNotMatch(script, /PASSWORD|authorization|-u /i);
  });
});

describe("entrypoint.sh", () => {
  const script = readFileSync(join(here, "..", "entrypoint.sh"), "utf8");

  it("offers the Claude sign-in helpers", () => {
    assert.match(script, /login\) shift; exec claude auth login "\$@" ;;/);
    assert.match(script, /setup-token\) exec claude setup-token ;;/);
  });

  it("keeps the runtime password out of the gateway environment", () => {
    assert.match(script, /exec env -u ROCKY_SERVER_PASSWORD ROCKY_SECRET_FILE=/);
    assert.match(script, /unset DT_PLATFORM_TOKEN/);
  });
});
