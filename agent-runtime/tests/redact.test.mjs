import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { REDACTED, redactDeep, redactEnv, redactText } from "../src/optional-gateway/redact.mjs";

// Synthetic values only; none of these are real credentials.
const CASES = [
  ["Dynatrace platform token", `token dt0s16.ABCDEFGH12345678.${"A".repeat(64)} end`],
  ["Authorization bearer header", "Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123"],
  ["Authorization basic header", "authorization: Basic b3BlbmNvZGU6c2VjcmV0"],
  ["URL credentials", "https://user:s3cret@example.com/path"],
  ["Anthropic key", "ANTHROPIC key sk-ant-api03-abcdefghijklmnopqrstuvwxyz"],
  ["OpenAI key", "key=sk-proj-abcdefghijklmnopqrstuvwxyz012345"],
  ["AWS access key id", "AKIAABCDEFGHIJKLMNOP"],
  ["GitHub token", `ghp_${"a".repeat(36)}`],
  ["JWT", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlc2lnbmF0dXJl"],
  ["password assignment", "password=hunter2hunter2"],
  ["JSON secret", '{"client_secret": "abcd1234efgh"}'],
  ["private key", "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----"],
  ["cookie header", "Cookie: session=abcdef; other=1"],
];

describe("redactText", () => {
  for (const [name, input] of CASES) {
    it(`redacts ${name}`, () => {
      const output = redactText(input);
      assert.ok(output.includes(REDACTED), `expected redaction in: ${output}`);
    });
  }

  it("keeps the secret value out of the output", () => {
    const secret = "s3cretValue987";
    assert.doesNotMatch(redactText(`DT_PLATFORM_TOKEN=${secret}`), new RegExp(secret));
    assert.doesNotMatch(redactText(`https://u:${secret}@h.example.com`), new RegExp(secret));
  });

  it("leaves ordinary text alone", () => {
    const text = "The checkout service had 412 errors between 10:00 and 10:15 UTC.";
    assert.equal(redactText(text), text);
  });

  it("is idempotent", () => {
    const once = redactText("password=hunter2hunter2");
    assert.equal(redactText(once), once);
  });
});

describe("redactEnv", () => {
  it("masks variables with sensitive names", () => {
    const out = redactEnv({
      DT_PLATFORM_TOKEN: "x",
      OPENCODE_SERVER_PASSWORD: "x",
      AWS_SECRET_ACCESS_KEY: "x",
      OPENAI_API_KEY: "x",
      GOOGLE_APPLICATION_CREDENTIALS: "x",
      BASIC_AUTH: "x",
      LOG_LEVEL: "info",
    });
    assert.equal(out.LOG_LEVEL, "info");
    for (const name of ["DT_PLATFORM_TOKEN", "OPENCODE_SERVER_PASSWORD", "AWS_SECRET_ACCESS_KEY", "OPENAI_API_KEY", "GOOGLE_APPLICATION_CREDENTIALS", "BASIC_AUTH"]) {
      assert.equal(out[name], REDACTED, name);
    }
  });
});

describe("redactDeep", () => {
  it("redacts nested values and sensitive keys", () => {
    const out = redactDeep({ headers: { Authorization: "Basic abc", other: "ok" }, list: ["password=abcdefgh"] });
    assert.equal(out.headers.Authorization, REDACTED);
    assert.equal(out.headers.other, "ok");
    assert.match(out.list[0], /\[REDACTED\]/);
  });
});
