import { AppRoot } from "@dynatrace/strato-components/core";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { SessionSidebar } from "../../src/components/SessionSidebar";
import { SESSION } from "../fixtures";

let connected = true;
jest.mock("../../src/app/ConnectionContext", () => ({
  useConnection: () => ({ connectionRef: connected ? { connectionId: "c1" } : null }),
}));
jest.mock("../../src/app/RuntimeDataContext", () => ({
  useRuntimeData: () => ({
    saved: { data: [], loading: false, error: null, refresh: () => undefined },
    ephemeral: { data: [SESSION], loading: false, error: null, refresh: () => undefined },
  }),
}));

function Location() {
  return <output aria-label="Location">{useLocation().pathname}</output>;
}

// Like the app shell, the sidebar renders outside the page routes.
function renderAt(path: string) {
  return render(
    <AppRoot>
      <MemoryRouter initialEntries={[path]}>
        <SessionSidebar />
        <Location />
        <Routes>
          <Route path="*" element={null} />
        </Routes>
      </MemoryRouter>
    </AppRoot>,
  );
}

describe("SessionSidebar", () => {
  beforeEach(() => {
    connected = true;
  });

  it("starts a new session from an active one", () => {
    renderAt(`/agent/session/${SESSION.id}`);
    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    expect(screen.getByLabelText("Location").textContent).toBe("/agent");
  });

  it("highlights the open session", () => {
    renderAt(`/agent/session/${SESSION.id}`);
    expect(screen.getByRole("button", { name: new RegExp(SESSION.title) }).getAttribute("aria-current")).toBe("page");
  });

  it("needs a connected runtime to start a session", () => {
    connected = false;
    renderAt("/connect");
    const button = screen.getByRole("button", { name: "New session" });
    expect(button.hasAttribute("disabled") || button.getAttribute("aria-disabled") === "true").toBe(true);
  });
});
