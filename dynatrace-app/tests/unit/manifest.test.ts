import { readFileSync } from "node:fs";
import { join } from "node:path";
import config from "../../app.config";

// The tenant validates the manifest at deploy time; these limits come from its
// app.manifest.schema.json so a bad value fails here instead of in `dt-app deploy`.
describe("app manifest", () => {
  const app = config.app!;

  it("keeps the description within the 80 characters the tenant accepts", () => {
    expect(app.description).toBeTruthy();
    expect(app.description!.length).toBeLessThanOrEqual(80);
  });

  it("uses the same version as package.json", () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf8")) as { version: string };
    expect(app.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(app.version).toBe(pkg.version);
  });

  it("defaults new connections to the runtime's username", () => {
    const schema = JSON.parse(readFileSync(join(__dirname, "../../settings/schemas/runtime-connections.schema.json"), "utf8")) as {
      properties: { username: { default: string } };
    };
    expect(schema.properties.username.default).toBe("rocky");
  });
});
