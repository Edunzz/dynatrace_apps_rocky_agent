import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const setup = join(repo, ".devcontainer", "setup.sh");

const BASE = {
  ROCKY_SETUP_DRY_RUN: "1",
  DT_ENVIRONMENT_URL: "https://abc12345.apps.dynatrace.com/",
  DT_APP_PLATFORM_TOKEN: "dt0s16.FAKEFAKEFAKE.notarealtokenvalue000",
};

function run(env) {
  const result = spawnSync("bash", [setup, "--non-interactive"], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME ?? process.env.USERPROFILE, ...env },
    encoding: "utf8",
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}`.replace(/\x1b\[[0-9;]*m/g, "") };
}

describe(".devcontainer/setup.sh", () => {
  it("deploys the app only when no runtime token is given", () => {
    const r = run(BASE);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /\[dry-run\] npx dt-app deploy --no-open --non-interactive/);
    assert.doesNotMatch(r.out, /docker compose up/);
    assert.match(r.out, /App:\s+https:\/\/abc12345\.apps\.dynatrace\.com\/ui\/apps\/my\.rocky\.agent/);
  });

  it("starts the runtime and builds the Codespaces URL without echoing secrets", () => {
    const r = run({
      ...BASE,
      DT_PLATFORM_TOKEN: "dt0s16.FAKEFAKEFAKE.notarealtokenvalue111",
      OPENCODE_MODEL: "anthropic/claude-sonnet-4-5",
      ANTHROPIC_API_KEY: "sk-ant-fake-not-real-0000000000",
      CODESPACE_NAME: "demo-abc",
      GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: "app.github.dev",
    });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /\[dry-run\] docker compose up -d --build/);
    assert.match(r.out, /Runtime:\s+https:\/\/demo-abc-4096\.app\.github\.dev/);
    assert.match(r.out, /Password: generated/);
    assert.doesNotMatch(r.out, /notarealtokenvalue|sk-ant-fake/);
    assert.doesNotMatch(r.out, /ports visibility/, "the port stays private unless requested");
  });

  it("skips the deployment without an app token", () => {
    const r = run({ ROCKY_SETUP_DRY_RUN: "1", DT_ENVIRONMENT_URL: BASE.DT_ENVIRONMENT_URL });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /skipping the app deployment/);
  });

  for (const [name, url, message] of [
    ["an HTTP URL", "http://abc12345.apps.dynatrace.com", /HTTPS URL/],
    ["a URL with a path", "https://abc12345.apps.dynatrace.com/ui", /HTTPS URL/],
    ["the classic URL", "https://abc12345.live.dynatrace.com", /platform URL/],
  ]) {
    it(`rejects ${name}`, () => {
      const r = run({ ...BASE, DT_ENVIRONMENT_URL: url });
      assert.equal(r.status, 1, r.out);
      assert.match(r.out, message);
    });
  }

  it("rejects a short runtime password", () => {
    const r = run({ ...BASE, ROCKY_START_RUNTIME: "true", DT_PLATFORM_TOKEN: "dt0s16.FAKEFAKEFAKE.notarealtokenvalue111", OPENCODE_SERVER_PASSWORD: "short" });
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /at least 16 characters/);
  });
});

describe(".devcontainer/devcontainer.json", () => {
  const raw = readFileSync(join(repo, ".devcontainer", "devcontainer.json"), "utf8");
  const config = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ""));

  it("pins the image and features", () => {
    assert.match(config.image, /:\d+\.\d+\.\d+-24-bookworm$/);
    for (const feature of Object.keys(config.features)) assert.match(feature, /:\d+\.\d+\.\d+$/, feature);
  });

  it("asks for the deployment parameters as Codespaces secrets", () => {
    for (const name of ["DT_ENVIRONMENT_URL", "DT_APP_PLATFORM_TOKEN", "DT_PLATFORM_TOKEN", "OPENCODE_SERVER_PASSWORD"]) {
      assert.ok(config.secrets[name]?.description, name);
    }
    assert.equal(config.postCreateCommand, "bash .devcontainer/post-create.sh");
  });
});
