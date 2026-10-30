import { render } from "@testing-library/react";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RockyLogo } from "../../src/components/RockyLogo";

// dt-app deploys <app root>/icon.svg as the launcher icon. It is the RockyLogo
// rendered at 128 px; regenerate it after changing the logo with:
//   UPDATE_ICON=1 npx jest tests/ui/logo.test.tsx
describe("RockyLogo", () => {
  it("is the app icon", () => {
    const markup = `${renderToStaticMarkup(<RockyLogo size={128} title="Rocky Agent" />)}\n`;
    const iconPath = join(__dirname, "../../icon.svg");
    if (process.env.UPDATE_ICON === "1") writeFileSync(iconPath, markup);
    expect(readFileSync(iconPath, "utf8")).toBe(markup);
  });

  it("is decorative without a title and named with one", () => {
    const { container, rerender } = render(<RockyLogo />);
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    rerender(<RockyLogo title="Rocky Agent" />);
    expect(container.querySelector("svg")?.getAttribute("role")).toBe("img");
    expect(container.querySelector("svg")?.getAttribute("aria-label")).toBe("Rocky Agent");
  });
});
