import { PageLayout } from "@dynatrace/strato-components/layouts";
import React from "react";
import { SessionSidebar } from "./SessionSidebar";
import { StatusBar } from "./StatusBar";

// Status bar on top; sessions on the left; the current page in the center.
// The sidebar is resizable and collapses on narrow viewports.
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <PageLayout aria-label="Rocky Agent">
      <PageLayout.Header>
        <StatusBar />
      </PageLayout.Header>
      <PageLayout.Sidebar defaultWidth={300} minWidth={240} breakpoint={900}>
        <SessionSidebar />
      </PageLayout.Sidebar>
      <PageLayout.Content>
        <main style={{ height: "100%", overflowY: "auto" }}>{children}</main>
      </PageLayout.Content>
    </PageLayout>
  );
}
