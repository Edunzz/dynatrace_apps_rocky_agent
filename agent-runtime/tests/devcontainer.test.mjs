import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const deploy = join(repo, "dynatrace-app", "scripts", "deploy.sh");
const welcome = join(repo, ".devcontainer", "welcome.sh");
const TOKEN = "dt0s16.FAKEFAKEFAKE.notarealtokenvalue000";

function bash(script, env, args = []) {
  const result = spawnSync("bash", [script, ...args], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME ?? process.env.USERPROFILE, ...env },
    encoding: "utf8",
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

describe("dynatrace-app/scripts/deploy.sh (npm run deploy:token)", () => {
  it("deploys with the platform token and prints the app link", () => {
    const r = bash(deploy, { ROCKY_DEPLOY_DRY_RUN: "1", DT_APP_ENVIRONMENT_URL: "https://abc12345.apps.dynatrace.com/", DT_APP_PLATFORM_TOKEN: TOKEN }, ["--yes"]);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /Deploying my\.rocky\.agent 0\.1\.0 to https:\/\/abc12345\.apps\.dynatrace\.com/);
    assert.match(r.out, /\[dry-run\] npx dt-app deploy --environment-url https:\/\/abc12345\.apps\.dynatrace\.com/);
    assert.match(r.out, /Open it at https:\/\/abc12345\.apps\.dynatrace\.com\/ui\/apps\/my\.rocky\.agent/);
    assert.doesNotMatch(r.out, /notarealtokenvalue/);
  });

  it("explains what is missing", () => {
    const r = bash(deploy, { ROCKY_DEPLOY_DRY_RUN: "1" }, ["--yes"]);
    assert.equal(r.status, 1);
    assert.match(r.out, /Missing: DT_APP_ENVIRONMENT_URL DT_APP_PLATFORM_TOKEN/);
  });

  it("rejects the classic environment URL", () => {
    const r = bash(deploy, { ROCKY_DEPLOY_DRY_RUN: "1", DT_APP_ENVIRONMENT_URL: "https://abc12345.live.dynatrace.com", DT_APP_PLATFORM_TOKEN: TOKEN }, ["--yes"]);
    assert.equal(r.status, 1);
    assert.match(r.out, /must be the platform URL/);
  });

  it("passes extra arguments to dt-app deploy", () => {
    const r = bash(deploy, { ROCKY_DEPLOY_DRY_RUN: "1", DT_APP_ENVIRONMENT_URL: "https://abc12345.apps.dynatrace.com", DT_APP_PLATFORM_TOKEN: TOKEN }, ["--yes", "--dry-run"]);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /dt-app deploy --environment-url \S+ --dry-run/);
  });
});

describe(".devcontainer", () => {
  const raw = readFileSync(join(repo, ".devcontainer", "devcontainer.json"), "utf8");
  const config = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ""));

  it("pins the image and installs the app dependencies", () => {
    assert.match(config.image, /:\d+\.\d+\.\d+-24-bookworm$/);
    assert.match(config.postCreateCommand, /npm ci --prefix dynatrace-app/);
    assert.equal(config.postAttachCommand, "bash .devcontainer/welcome.sh");
  });

  it("asks for the same two secrets as the other Edunzz Dynatrace apps", () => {
    assert.deepEqual(Object.keys(config.secrets), ["DT_APP_ENVIRONMENT_URL", "DT_APP_PLATFORM_TOKEN"]);
    assert.match(config.secrets.DT_APP_PLATFORM_TOKEN.description, /app-engine:apps:install/);
  });

  it("welcome message shows where the app goes without printing the token", () => {
    const r = bash(welcome, { DT_APP_ENVIRONMENT_URL: "https://abc12345.apps.dynatrace.com", DT_APP_PLATFORM_TOKEN: TOKEN });
    assert.match(r.out, /Environment URL : https:\/\/abc12345\.apps\.dynatrace\.com/);
    assert.match(r.out, /Platform token  : set/);
    assert.match(r.out, /npm run deploy:token/);
    assert.doesNotMatch(r.out, /notarealtokenvalue/);
  });

  it("offers npm run deploy:token from the repository root", () => {
    const root = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
    assert.match(root.scripts["deploy:token"], /--prefix dynatrace-app run deploy:token/);
    const app = JSON.parse(readFileSync(join(repo, "dynatrace-app", "package.json"), "utf8"));
    assert.equal(app.scripts["deploy:token"], "bash scripts/deploy.sh");
  });
});

describe("docker-compose.yml", () => {
  const compose = readFileSync(join(repo, "docker-compose.yml"), "utf8");

  it("defaults to production rules and keeps the tunnel optional", () => {
    assert.match(compose, /NODE_ENV: \$\{NODE_ENV:-production\}/);
    assert.match(compose, /profiles: \["tunnel"\]/);
    assert.match(compose, /condition: service_healthy/);
    assert.match(compose, /cloudflare\/cloudflared:[\d.]+@sha256:[0-9a-f]{64}/);
    assert.match(compose, /"127\.0\.0\.1:4096:4096"/);
  });

  it("pulls a versioned image from Docker Hub and keeps the Claude login in a volume", () => {
    assert.match(compose, /image: \$\{ROCKY_IMAGE:-docker\.io\/edunzz\/rocky-agent:\d+\.\d+\.\d+\}/);
    assert.doesNotMatch(compose, /:latest\b/);
    assert.match(compose, /- rocky-home:\/home\/rocky/);
    assert.doesNotMatch(compose, /^\s+build:/m, "building is opt-in through docker-compose.build.yml");
    const build = readFileSync(join(repo, "docker-compose.build.yml"), "utf8");
    assert.match(build, /context: \.\/agent-runtime/);
  });
});
