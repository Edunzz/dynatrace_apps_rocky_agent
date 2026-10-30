import { Button } from "@dynatrace/strato-components/buttons";
import { Chip, MessageContainer } from "@dynatrace/strato-components/content";
import { Flex, Surface } from "@dynatrace/strato-components/layouts";
import { ExternalLink, Heading, Paragraph, Strong, Text } from "@dynatrace/strato-components/typography";
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useConnection } from "../app/ConnectionContext";
import { useRuntimeData } from "../app/RuntimeDataContext";
import { REPO } from "../app/deploymentGuides";
import { Console } from "../app/theme";
import { ConnectionForm } from "../components/ConnectionForm";
import { DeploymentGuide } from "../components/DeploymentGuide";
import { ConfirmModal } from "../components/modals";
import { PlatformTokenGuide } from "../components/PlatformTokenGuide";
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
    <Flex flexDirection="column" gap={24} padding={24} style={{ maxWidth: 1400, margin: "0 auto" }}>
      <header
        style={{
          background: Console.surface,
          border: `1px solid ${Console.border}`,
          borderRadius: 16,
          padding: 24,
          color: Console.text,
        }}
      >
        <Text style={{ color: Console.green, fontFamily: Console.mono, letterSpacing: 2, fontSize: 12 }}>ROCKY AGENT</Text>
        <Heading level={1} style={{ color: Console.text, margin: "8px 0" }}>
          Connect your Rocky Agent runtime
        </Heading>
        <Paragraph style={{ color: Console.muted, maxWidth: 860 }}>
          Run the Rocky Agent container anywhere your Dynatrace App can securely reach it. You can use Docker, Amazon ECS, Azure
          Container Apps, Kubernetes, or an existing compatible runtime.
        </Paragraph>
      </header>

      <MessageContainer variant="warning">
        <MessageContainer.Title>Security first</MessageContainer.Title>
        <MessageContainer.Description>
          Never expose the runtime directly to the Internet without TLS. The app talks to the runtime from a Dynatrace App Function
          over HTTPS; the runtime password never reaches the browser after it is saved, and the Dynatrace platform token stays
          inside the runtime container.
        </MessageContainer.Description>
      </MessageContainer>

      {error && <MessageContainer variant="critical">{error}</MessageContainer>}

      {connections.length > 0 && (
        <section aria-labelledby="connections-heading">
          <Heading level={3} id="connections-heading">
            Your runtime connections
          </Heading>
          <Flex flexDirection="column" gap={8} style={{ marginTop: 8 }}>
            {connections.map((c) => (
              <Surface key={c.objectId} padding={12}>
                <Flex alignItems="center" gap={12} flexWrap="wrap">
                  <div style={{ flex: "1 1 260px" }}>
                    <Strong>{c.displayName}</Strong>
                    <Text style={{ display: "block", fontSize: 12, opacity: 0.8 }}>{c.runtimeUrl}</Text>
                    <Text style={{ fontSize: 12, opacity: 0.8 }}>
                      {c.lastSuccessfulConnection ? `Last successful connection ${new Date(c.lastSuccessfulConnection).toLocaleString()}` : "Not verified yet"}
                      {c.runtimeVersion ? ` · v${c.runtimeVersion}` : ""}
                    </Text>
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
                </Flex>
              </Surface>
            ))}
          </Flex>
          {!creating && !editing && (
            <Button style={{ marginTop: 12 }} onClick={() => setCreating(true)}>
              Add connection
            </Button>
          )}
        </section>
      )}

      <Surface padding={16}>
        <section aria-labelledby="token-heading">
          <Heading level={3} id="token-heading">
            Dynatrace platform token
          </Heading>
          <PlatformTokenGuide />
        </section>
      </Surface>

      <div style={{ display: "grid", gap: 24, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 440px), 1fr))", alignItems: "start" }}>
        <section aria-labelledby="deploy-heading">
          <Heading level={3} id="deploy-heading">
            Deploy the runtime
          </Heading>
          <DeploymentGuide />
        </section>
        {(creating || editing) && (
          <Surface padding={16}>
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
          </Surface>
        )}
      </div>

      <Paragraph>
        Documentation: <ExternalLink href={`${REPO}#readme`}>README</ExternalLink> ·{" "}
        <ExternalLink href={`${REPO}/blob/main/SECURITY.md`}>Security</ExternalLink> ·{" "}
        <ExternalLink href={`${REPO}/blob/main/docs/dynatrace-setup.md`}>Dynatrace setup</ExternalLink>
      </Paragraph>

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
    </Flex>
  );
}
