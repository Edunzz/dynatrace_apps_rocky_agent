import { PageLayout } from "@dynatrace/strato-components/layouts";
import React, { useState } from "react";
import { SessionSidebar } from "./SessionSidebar";
import { StatusBar } from "./StatusBar";

const COLLAPSED_KEY = "rocky-agent.sidebarCollapsed";

// A per-browser convenience: storage may be unavailable, so failures are ignored.
function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function saveCollapsed(value: boolean) {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, String(value));
  } catch {
    // Ignore: the choice just is not remembered.
  }
}

// Status bar on top; sessions on the left; the current page in the center.
// The sidebar is resizable, can be hidden from the status bar (the choice is
// remembered), and turns into a drawer on narrow viewports.
export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [narrow, setNarrow] = useState(false);

  const changeCollapsed = (value: boolean) => {
    setCollapsed(value);
    if (!narrow) saveCollapsed(value);
  };

  return (
    <PageLayout aria-label="Rocky Agent">
      <PageLayout.Header>
        <StatusBar sidebarCollapsed={collapsed} onToggleSidebar={() => changeCollapsed(!collapsed)} />
      </PageLayout.Header>
      <PageLayout.Sidebar
        defaultWidth={300}
        minWidth={240}
        breakpoint={900}
        collapsed={collapsed}
        onCollapsedChange={changeCollapsed}
        onBreakpointTransition={(below) => {
          setNarrow(below);
          setCollapsed(below ? true : readCollapsed());
        }}
      >
        <SessionSidebar />
      </PageLayout.Sidebar>
      <PageLayout.Content>
        <main style={{ height: "100%", overflowY: "auto" }}>{children}</main>
      </PageLayout.Content>
    </PageLayout>
  );
}
