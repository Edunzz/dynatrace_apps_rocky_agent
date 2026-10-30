import { Button } from "@dynatrace/strato-components/buttons";
import { Chip, MessageContainer } from "@dynatrace/strato-components/content";
import { Flex } from "@dynatrace/strato-components/layouts";
import { ExternalLink, Heading } from "@dynatrace/strato-components/typography";
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useConnection } from "../app/ConnectionContext";
import { useRuntimeData } from "../app/RuntimeDataContext";
import { REPO } from "../app/deploymentGuides";
import { ConnectionForm } from "../components/ConnectionForm";
import { DeploymentGuide } from "../components/DeploymentGuide";
import { ConfirmModal } from "../components/modals";
import { PlatformTokenGuide } from "../components/PlatformTokenGuide";
import { RockyLogo } from "../components/RockyLogo";
import type { StoredConnection } from "../models/connection";
import { connectionsApi } from "../services/connections";

export function WelcomePage() {
  const navigate = useNavigate();
  const { connections, active, select, setMemoryPassword, reload, error } = useConnection();
  const { status } = useRuntimeData();
  const [editing, setEditing] = useState<StoredConnection | null>(null);
  const [creating, setCreating] = useState(connections.length === 0);
  const [removing, setRemoving] = useState<StoredConnection | null>(null);

  return (
    <div className="rk-page">
      <header className="rk-card rk-hero rk-hero--split">
        <RockyLogo size={64} />
        <div className="rk-stack" style={{ gap: 6 }}>
          <p className="rk-eyebrow">Rocky Agent</p>
          <h1 className="rk-title">Connect your Rocky Agent runtime</h1>
          <p className="rk-lead">
            Run the Rocky Agent container anywhere your Dynatrace App can securely reach it. You can use Docker, Amazon ECS, Azure
            Container Apps, Kubernetes, or an existing compatible runtime.
          </p>
        </div>
      </header>

      <MessageContainer variant="warning">
        <MessageContainer.Title>Security first</MessageContainer.Title>
        <MessageContainer.Description>
          Never expose the runtime directly to the Internet without TLS. The app talks to the runtime from a Dynatrace App Function
          over HTTPS; the runtime password never reaches the browser after it is saved, and the Dynatrace platform token stays
          inside the runtime container.
        </MessageContainer.Description>
      </MessageContainer>

      {error && (
        <MessageContainer variant="critical">
          <MessageContainer.Description>{error}</MessageContainer.Description>
        </MessageContainer>
      )}

      {connections.length > 0 && (
        <section aria-labelledby="connections-heading">
          <Heading level={4} id="connections-heading">
            Your runtime connections
          </Heading>
          <Flex flexDirection="column" gap={8} style={{ marginTop: 8 }}>
            {connections.map((c) => (
              <div key={c.objectId} className="rk-card rk-card--compact rk-conn">
                <div className="rk-conn__main">
                  <span className="rk-conn__name">{c.displayName}</span>
                  <span className="rk-conn__url">{c.runtimeUrl}</span>
                  <p className="rk-small">
                    {c.lastSuccessfulConnection ? `Last successful connection ${new Date(c.lastSuccessfulConnection).toLocaleString()}` : "Not verified yet"}
                    {c.runtimeVersion ? ` · v${c.runtimeVersion}` : ""}
                  </p>
                </div>
                {active?.objectId === c.objectId && (
                  <Chip color={status.error ? "critical" : status.data ? "success" : "neutral"}>
                    {status.error ? "Active · unavailable" : status.data ? "Active · connected" : "Active"}
                  </Chip>
                )}
                <Button
                  variant="emphasized"
                  color="primary"
                  onClick={() => {
                    select(c.objectId);
                    navigate("/agent");
                  }}
                >
                  Use
                </Button>
                <Button onClick={() => { setEditing(c); setCreating(false); }}>Edit</Button>
                <Button color="critical" onClick={() => setRemoving(c)}>
                  Delete
                </Button>
              </div>
            ))}
          </Flex>
          {!creating && !editing && (
            <Button style={{ marginTop: 12 }} onClick={() => setCreating(true)}>
              Add connection
            </Button>
          )}
        </section>
      )}

      <section aria-labelledby="token-heading" className="rk-card">
        <Heading level={4} id="token-heading">
          Dynatrace platform token
        </Heading>
        <PlatformTokenGuide />
      </section>

      <div style={{ display: "grid", gap: 24, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 440px), 1fr))", alignItems: "start" }}>
        <section aria-labelledby="deploy-heading" className="rk-card">
          <Heading level={4} id="deploy-heading">
            Deploy the runtime
          </Heading>
          <DeploymentGuide />
        </section>
        {(creating || editing) && (
          <div className="rk-card">
            <ConnectionForm
              key={editing?.objectId ?? "new"}
              existing={editing}
              onCancel={connections.length > 0 ? () => { setCreating(false); setEditing(null); } : undefined}
              onSaved={async (objectId, memoryPassword) => {
                await reload();
                select(objectId);
                if (memoryPassword) setMemoryPassword(memoryPassword);
                setCreating(false);
                setEditing(null);
                navigate("/agent");
              }}
            />
          </div>
        )}
      </div>

      <p className="rk-small">
        Documentation: <ExternalLink href={`${REPO}#readme`}>README</ExternalLink> ·{" "}
        <ExternalLink href={`${REPO}/blob/main/SECURITY.md`}>Security</ExternalLink> ·{" "}
        <ExternalLink href={`${REPO}/blob/main/docs/dynatrace-setup.md`}>Dynatrace setup</ExternalLink>
      </p>

      <ConfirmModal
        show={removing !== null}
        title="Delete connection"
        critical
        confirmLabel="Delete connection"
        message={`Delete the connection "${removing?.displayName ?? ""}"? The runtime itself and saved sessions are not affected.`}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          await connectionsApi.remove(removing);
          if (active?.objectId === removing.objectId) select(null);
          await reload();
        }}
      />
    </div>
  );
}
