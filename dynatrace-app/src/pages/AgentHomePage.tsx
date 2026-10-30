import { Button } from "@dynatrace/strato-components/buttons";
import { MessageContainer } from "@dynatrace/strato-components/content";
import { FormField, Label, TextArea } from "@dynatrace/strato-components/forms";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Paragraph, Text } from "@dynatrace/strato-components/typography";
import { PlayIcon } from "@dynatrace/strato-icons";
import React, { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useConnection } from "../app/ConnectionContext";
import { useRuntimeData } from "../app/RuntimeDataContext";
import { Console } from "../app/theme";
import { PasswordPrompt } from "../components/PasswordPrompt";
import { PromptCards } from "../components/PromptCards";
import { StartSessionModal } from "../components/StartSessionModal";
import { errorMessage } from "../services/functions";

export function AgentHomePage() {
  const navigate = useNavigate();
  const { active, connectionRef, needsPassword, loading } = useConnection();
  const { status, ephemeral } = useRuntimeData();
  const [prompt, setPrompt] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  if (!loading && !active) return <Navigate to="/connect" replace />;

  const modelBlocked = status.data?.modelProvider.status === "authentication_required";

  return (
    <div style={{ minHeight: "100%", background: Console.background, padding: 24 }}>
      <Flex flexDirection="column" gap={20} style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div>
          <Text style={{ color: Console.green, fontFamily: Console.mono, letterSpacing: 2, fontSize: 12 }}>
            {active ? `CONNECTED TO ${active.displayName.toUpperCase()}` : "ROCKY AGENT"}
          </Text>
          <Heading level={2} style={{ color: Console.text, margin: "6px 0" }}>
            What do you want to investigate?
          </Heading>
          <Paragraph style={{ color: Console.muted }}>
            Pick a starting point or write your own request. The agent works read-only by default and asks for explicit confirmation
            before it changes anything.
          </Paragraph>
        </div>

        {needsPassword && <PasswordPrompt />}
        {status.error && connectionRef ? (
          <MessageContainer variant="critical">
            <MessageContainer.Title>Runtime unavailable</MessageContainer.Title>
            <MessageContainer.Description>{errorMessage(status.error)}</MessageContainer.Description>
            <MessageContainer.Actions>
              <Button onClick={() => navigate("/connect")}>Check connection</Button>
            </MessageContainer.Actions>
          </MessageContainer>
        ) : null}
        {modelBlocked && (
          <MessageContainer variant="warning">
            The model provider needs authentication ({status.data?.modelProvider.provider ?? "unknown provider"}). Set its API key or
            role in the runtime deployment; the agent cannot answer until then.
          </MessageContainer>
        )}
        {status.data?.dynatrace.status && status.data.dynatrace.status !== "connected" && (
          <MessageContainer variant="warning">
            Dynatrace connection: unavailable. {status.data.dynatrace.detail ?? ""} The agent can still run, but Dynatrace queries will
            fail until the runtime can authenticate.
          </MessageContainer>
        )}

        <PromptCards
          selected={selected}
          onPick={(p) => {
            setSelected(p.id);
            setPrompt(p.text);
          }}
        />

        <FormField>
          <Label>
            <span style={{ color: Console.text }}>Command</span>
          </Label>
          <TextArea
            value={prompt}
            onChange={(v) => {
              setPrompt(v);
              setSelected(null);
            }}
            rows={5}
            resize="vertical"
            placeholder="Describe the problem, the affected service, the impact and the time range…"
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && prompt.trim() && connectionRef) setStarting(true);
            }}
          />
        </FormField>

        <Button
          variant="accent"
          color="primary"
          width="full"
          disabled={!prompt.trim() || !connectionRef || Boolean(status.error)}
          onClick={() => setStarting(true)}
          style={{ minHeight: 56, fontSize: 18, letterSpacing: 1, borderRadius: 16 }}
        >
          <Button.Prefix>
            <PlayIcon />
          </Button.Prefix>
          Let’s Rock
        </Button>
        <Text style={{ color: Console.muted, fontSize: 12 }}>
          Ctrl+Enter also starts. {ephemeral.data ? `${ephemeral.data.length} ephemeral session(s) in this runtime.` : ""}
        </Text>
      </Flex>

      {connectionRef && (
        <StartSessionModal
          show={starting}
          connection={connectionRef}
          prompt={prompt}
          onClose={() => setStarting(false)}
          onStarted={(sessionId) => {
            setStarting(false);
            ephemeral.refresh();
            navigate(`/agent/session/${encodeURIComponent(sessionId)}`);
          }}
        />
      )}
    </div>
  );
}
