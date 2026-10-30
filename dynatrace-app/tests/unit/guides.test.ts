import { DEPLOYMENT_GUIDES } from "../../src/app/deploymentGuides";
import {
  APP_DEPLOY_SCOPES,
  RCA_REQUIRED_SCOPES,
  READONLY_SCOPES,
  RECOMMENDED_SCOPES,
  TOKEN_PROFILES,
} from "../../src/app/platformToken";

describe("deployment guides", () => {
  it("lists the local option first, then Codespaces and the cloud targets", () => {
    expect(DEPLOYMENT_GUIDES.map((g) => g.id)).toEqual(["local", "codespaces", "docker", "ecs", "aca", "kubernetes", "existing"]);
  });

  it("explains why the local option needs dt-app dev", () => {
    const local = DEPLOYMENT_GUIDES[0];
    expect(local.summary).toMatch(/dt-app dev/);
    expect(local.summary).toMatch(/cannot reach your localhost/);
  });

  it("covers every required section in every guide", () => {
    const required = [
      "Prerequisites",
      "Deployment commands",
      "Environment variables",
      "Secret configuration",
      "Networking requirements",
      "TLS recommendation",
      "Health-check instructions",
      "Cleanup instructions",
      "Cost and security notes",
    ];
    for (const guide of DEPLOYMENT_GUIDES) {
      expect(guide.sections.map((s) => s.title)).toEqual(required);
      expect(guide.checklist.length).toBeGreaterThan(0);
    }
  });

  it("never uses latest image tags", () => {
    expect(JSON.stringify(DEPLOYMENT_GUIDES)).not.toMatch(/:latest\b/);
  });
});

describe("platform token scopes", () => {
  it("lets the recommended profile satisfy the RCA skill's prerequisite check", () => {
    for (const scope of RCA_REQUIRED_SCOPES) expect(RECOMMENDED_SCOPES).toContain(scope);
    expect(RECOMMENDED_SCOPES).toEqual(expect.arrayContaining(["storage:user.events:read", "storage:user.sessions:read"]));
  });

  it("keeps the read-only profile free of write scopes", () => {
    expect(READONLY_SCOPES.filter((s) => /:(write|delete|install|admin)$/.test(s))).toEqual([]);
  });

  it("has no duplicate scopes and matches the dtctl safety levels", () => {
    for (const profile of TOKEN_PROFILES) expect(new Set(profile.scopes).size).toBe(profile.scopes.length);
    expect(TOKEN_PROFILES.map((p) => p.safetyLevel)).toEqual(["readwrite-mine", "readonly"]);
  });

  it("deploys the app with a separate, minimal token", () => {
    expect([...APP_DEPLOY_SCOPES]).toEqual(["app-engine:apps:install", "app-engine:apps:run"]);
  });
});
