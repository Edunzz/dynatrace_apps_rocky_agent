import { ToastContainer } from "@dynatrace/strato-components/notifications";
import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { AgentHomePage } from "../pages/AgentHomePage";
import { SavedSessionPage } from "../pages/SavedSessionPage";
import { SessionPage } from "../pages/SessionPage";
import { WelcomePage } from "../pages/WelcomePage";
import { ConnectionProvider, useConnection } from "./ConnectionContext";
import { RuntimeDataProvider } from "./RuntimeDataContext";

function Home() {
  const { active, loading } = useConnection();
  if (loading) return null;
  return <Navigate to={active ? "/agent" : "/connect"} replace />;
}

export const App = () => (
  <ConnectionProvider>
    <RuntimeDataProvider>
      <AppShell>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/connect" element={<WelcomePage />} />
          <Route path="/agent" element={<AgentHomePage />} />
          <Route path="/agent/session/:sessionId" element={<SessionPage />} />
          <Route path="/saved/:savedId" element={<SavedSessionPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
      <ToastContainer />
    </RuntimeDataProvider>
  </ConnectionProvider>
);
