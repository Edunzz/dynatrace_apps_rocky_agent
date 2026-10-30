import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import config from "../../app.config";
import { validateRuntimeUrl } from "../../src/utils/url";

const appRoot = join(__dirname, "../..");

// The tenant validates the manifest at deploy time; these limits come from its
// app.manifest.schema.json so a bad value fails here instead of in `dt-app deploy`.
describe("app manifest", () => {
  const app = config.app!;

  it("keeps the description within the 80 characters the tenant accepts", () => {
    expect(app.description).toBeTruthy();
    expect(app.description!.length).toBeLessThanOrEqual(80);
  });

  it("uses the same version as package.json", () => {
    const pkg = JSON.parse(readFileSync(join(appRoot, "package.json"), "utf8")) as { version: string };
    expect(app.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(app.version).toBe(pkg.version);
  });
});

interface SettingsProperty {
  type: unknown;
  nullable?: boolean;
  default?: unknown;
  constraints?: { type: string; pattern?: string }[];
}

interface SettingsSchema {
  schemaId: string;
  multiObject?: boolean;
  ordered?: boolean;
  properties: Record<string, SettingsProperty>;
}

// `dt-app deploy` only packages <sourceRoot>/settings/schemas. A schema anywhere
// else is silently left out, and every settings call for it then fails with 404.
describe("app settings schema", () => {
  const schemasDir = join(appRoot, config.build!.sourceRoot!, "settings", "schemas");
  const schemaPath = join(schemasDir, "runtime-connections.schema.json");
  const schema = () => JSON.parse(readFileSync(schemaPath, "utf8")) as SettingsSchema;

  it("lives where dt-app deploys it", () => {
    expect(existsSync(schemaPath)).toBe(true);
    expect(existsSync(join(appRoot, "settings"))).toBe(false);
    expect(readdirSync(schemasDir).filter((f) => f.endsWith(".schema.json"))).toEqual(["runtime-connections.schema.json"]);
  });

  it("matches the schema id the app uses", () => {
    expect(schema().schemaId).toBe("runtime-connections");
  });

  // Rules from Dynatrace's strict app settings meta-schema (schema_strict_apps.json).
  it("follows the rules the tenant enforces when it installs the schema", () => {
    const s = schema();
    if (s.multiObject) expect(typeof s.ordered).toBe("boolean");
    for (const [name, property] of Object.entries(s.properties)) {
      if (property.type === "list" || property.type === "set") {
        expect({ name, nullable: property.nullable ?? false }).toEqual({ name, nullable: false });
      }
    }
  });

  // The tenant rejects greedy quantifiers inside capture groups and quantified
  // groups ("Please use lazy quantifiers within your capture group"), so the
  // patterns use top-level alternatives without any group.
  it("uses regex patterns without groups", () => {
    const patterns = Object.values(schema().properties).flatMap((p) =>
      (p.constraints ?? []).filter((c) => c.type === "PATTERN").map((c) => c.pattern!),
    );
    expect(patterns.length).toBeGreaterThan(0);
    for (const pattern of patterns) expect({ pattern, group: /(^|[^\\])\(/.test(pattern) }).toEqual({ pattern, group: false });
  });

  describe("runtime URL pattern", () => {
    const pattern = () => {
      const constraint = schema().properties.runtimeUrl.constraints!.find((c) => c.type === "PATTERN")!;
      return new RegExp(constraint.pattern!);
    };

    it.each([
      "https://rocky-agent.example.com",
      "https://rocky-agent.example.com/",
      "https://rocky-agent.example.com:8443/rocky/v1",
      "https://universe-pixels-quotations-excited.trycloudflare.com",
      "http://localhost:4096",
      "http://localhost",
      "http://127.0.0.1:4096/",
      "http://[::1]:4096",
    ])("accepts %s, like the app", (url) => {
      expect(validateRuntimeUrl(url, { allowLocalHttp: true }).ok).toBe(true);
      expect(pattern().test(url)).toBe(true);
    });

    it.each([
      "http://rocky-agent.example.com",
      "http://localhost.example.com",
      "http://127.0.0.1.nip.io:4096",
      "http://localhost@example.com",
      "https://user:secret@rocky-agent.example.com",
      "https://rocky-agent.example.com/?token=1",
      "https://rocky-agent.example.com#top",
      "https://rocky agent.example.com",
      "ftp://rocky-agent.example.com",
    ])("rejects %s, like the app", (url) => {
      expect(validateRuntimeUrl(url, { allowLocalHttp: true }).ok).toBe(false);
      expect(pattern().test(url)).toBe(false);
    });
  });

  it("defaults new connections to the runtime's username", () => {
    expect(schema().properties.username.default).toBe("rocky");
  });
});
