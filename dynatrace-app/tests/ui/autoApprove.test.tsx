import { AppRoot } from "@dynatrace/strato-components/core";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import React from "react";
import { AboutModal, AppFooter, Disclaimer } from "../../src/components/About";
import { useAutoApprove } from "../../src/hooks/useAutoApprove";
import type { OcPermissionRequest } from "../../src/models/runtime";
import { PERMISSION, SESSION } from "../fixtures";

const second: OcPermissionRequest = { ...PERMISSION, id: "per_second" };

function setup(permissions: OcPermissionRequest[], reply = jest.fn().mockResolvedValue(undefined), onError = jest.fn()) {
  const hook = renderHook(({ list }) => useAutoApprove(SESSION.id, list, reply, onError), { initialProps: { list: permissions } });
  return { hook, reply, onError };
}

describe("useAutoApprove", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("is off by default and approves nothing", () => {
    const { hook, reply } = setup([PERMISSION]);
    expect(hook.result.current[0]).toBe(false);
    expect(reply).not.toHaveBeenCalled();
  });

  it("approves each pending request once, including new ones", async () => {
    const { hook, reply } = setup([PERMISSION]);
    act(() => hook.result.current[1](true));
    await waitFor(() => expect(reply).toHaveBeenCalledWith(PERMISSION.id, "once"));
    hook.rerender({ list: [PERMISSION, second] });
    hook.rerender({ list: [PERMISSION, second] });
    await waitFor(() => expect(reply).toHaveBeenCalledTimes(2));
    expect(reply).toHaveBeenLastCalledWith(second.id, "once");
    expect(reply.mock.calls.every(([, answer]) => answer === "once")).toBe(true);
  });

  it("remembers the choice for the session in this tab", () => {
    const first = setup([]);
    act(() => first.hook.result.current[1](true));
    first.hook.unmount();
    expect(setup([]).hook.result.current[0]).toBe(true);
  });

  it("reports a failed approval and retries it on the next update", async () => {
    const reply = jest.fn().mockRejectedValueOnce(new Error("runtime unavailable")).mockResolvedValue(undefined);
    const { hook, onError } = setup([PERMISSION], reply);
    act(() => hook.result.current[1](true));
    await waitFor(() => expect(onError).toHaveBeenCalled());
    hook.rerender({ list: [PERMISSION] });
    await waitFor(() => expect(reply).toHaveBeenCalledTimes(2));
  });
});

describe("About and disclaimer", () => {
  it("says the app is a community app with GitHub support only", () => {
    render(
      <AppRoot>
        <Disclaimer />
      </AppRoot>,
    );
    expect(screen.getByRole("note").textContent).toMatch(/not an official Dynatrace product/);
    expect(screen.getByRole("link", { name: /open an issue/ }).getAttribute("href")).toBe("https://github.com/Edunzz/dynatrace_apps_rocky_agent/issues");
  });

  it("shows author, source and the disclaimer in the about dialog", () => {
    render(
      <AppRoot>
        <AboutModal show onClose={() => undefined} />
      </AppRoot>,
    );
    const dialog = screen.getByRole("dialog", { name: "About Rocky Agent" });
    expect(dialog.textContent).toContain("Jose Eduardo Romero Jimenez");
    expect(dialog.textContent).toContain("github.com/Edunzz/dynatrace_apps_rocky_agent");
    expect(screen.getByRole("note").textContent).toMatch(/Use it at your own risk/);
  });

  it("repeats the disclaimer in the footer", () => {
    render(
      <AppRoot>
        <AppFooter />
      </AppRoot>,
    );
    expect(screen.getByRole("contentinfo").textContent).toMatch(/Built by Jose Eduardo Romero Jimenez .* Community app, not supported by Dynatrace/);
  });
});
