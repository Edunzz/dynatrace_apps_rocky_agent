/** @type {import('jest').Config} */
const tsJest = [
  "ts-jest",
  {
    tsconfig: {
      isolatedModules: true,
      allowJs: true,
      jsx: "react",
      module: "commonjs",
      moduleResolution: "node10",
      ignoreDeprecations: "6.0",
      esModuleInterop: true,
      target: "es2022",
      strict: true,
      skipLibCheck: true,
    },
  },
];

// ESM-only packages pulled in by Strato components that must be transformed for Jest.
const ESM_PACKAGES = [
  "d3-[a-z-]+",
  "internmap",
  "delaunator",
  "robust-predicates",
  "react-markdown",
  "remark-[a-z-]+",
  "rehype-[a-z-]+",
  "unified",
  "bail",
  "trough",
  "vfile[a-z-]*",
  "unist-[a-z-]+",
  "mdast-[a-z-]+",
  "hast-[a-z-]+",
  "hastscript",
  "micromark[a-z-]*",
  "decode-named-character-reference",
  "character-entities[a-z-]*",
  "character-reference-invalid",
  "is-[a-z-]+",
  "property-information",
  "space-separated-tokens",
  "comma-separated-tokens",
  "ccount",
  "escape-string-regexp",
  "markdown-table",
  "zwitch",
  "longest-streak",
  "devlop",
  "html-url-attributes",
  "html-void-elements",
  "web-namespaces",
  "estree-[a-z-]+",
  "trim-lines",
  "stringify-entities",
  "parse-entities",
];

module.exports = {
  projects: [
    {
      displayName: "unit",
      testEnvironment: "node",
      testMatch: ["<rootDir>/tests/unit/**/*.test.ts", "<rootDir>/tests/integration/**/*.test.ts"],
      transform: { "^.+\\.tsx?$": tsJest },
    },
    {
      displayName: "ui",
      testEnvironment: "jsdom",
      testEnvironmentOptions: { customExportConditions: ["node", "require", "default"] },
      testMatch: ["<rootDir>/tests/ui/**/*.test.tsx"],
      setupFiles: ["<rootDir>/tests/ui/setup.ts"],
      moduleNameMapper: {
        "\\.(css|svg|png|woff2?)$": "<rootDir>/tests/ui/styleStub.js",
        "^streamdown$": "<rootDir>/tests/ui/optionalPeerStub.js",
      },
      transform: { "^.+\\.[tj]sx?$": tsJest, "^.+\\.mjs$": tsJest },
      transformIgnorePatterns: [`/node_modules/(?!(${ESM_PACKAGES.join("|")})/)`],
    },
  ],
};
