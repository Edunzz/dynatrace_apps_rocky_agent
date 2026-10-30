import { Button } from "@dynatrace/strato-components/buttons";
import { MessageContainer } from "@dynatrace/strato-components/content";
import { FormField, Label, TextArea } from "@dynatrace/strato-components/forms";
import { Code } from "@dynatrace/strato-components/typography";
import { PlayIcon } from "@dynatrace/strato-icons";
import React, { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useConnection } from "../app/ConnectionContext";
import { useRuntimeData } from "../app/RuntimeDataContext";
import { PasswordPrompt } from "../components/PasswordPrompt";
import { PromptCards } from "../components/PromptCards";
import { RockyLogo } from "../components/RockyLogo";
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

  const claude = status.data?.claude;
  const claudeBlocked = claude?.status === "authentication_required" || claude?.status === "authentication_failed";

  return (
    <div className="rk-page rk-page--narrow">
      <header className="rk-hero rk-hero--split">
        <RockyLogo size={56} />
        <div className="rk-stack" style={{ gap: 6 }}>
          <p className="rk-eyebrow">{active ? `Connected to ${active.displayName}` : "Rocky Agent"}</p>
          <h1 className="rk-title">What do you want to investigate?</h1>
          <p className="rk-lead">
            Pick a starting point or write your own request. The agent works read-only by default and asks for explicit confirmation
            before it changes anything.
          </p>
        </div>
      </header>

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
      {status.data?.runtime.defaultPassword && (
        <MessageContainer variant="critical">
          <MessageContainer.Title>Change the runtime password</MessageContainer.Title>
          <MessageContainer.Description>
            <span>
              This runtime uses the public default password, so anyone who finds its address can use the agent with your Dynatrace token
              and your Claude account. On the computer that runs it, set ROCKY_SERVER_PASSWORD in <Code>.env</Code> (16 characters or
              more), run <Code>docker compose --profile tunnel up -d</Code> and then edit this connection with the new password.
            </span>
          </MessageContainer.Description>
          <MessageContainer.Actions>
            <Button onClick={() => navigate("/connect")}>Edit connection</Button>
          </MessageContainer.Actions>
        </MessageContainer>
      )}
      {claudeBlocked && claude && (
        <MessageContainer variant="warning">
          <MessageContainer.Title>
            {claude.status === "authentication_failed" ? "Claude rejected the runtime's sign-in" : "Claude is not signed in on the runtime"}
          </MessageContainer.Title>
          <MessageContainer.Description>
            <span>
              On the computer or server that runs the runtime, run <Code>{claude.loginCommand}</Code>, open the address it prints and
              sign in with your Claude account. Or set CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY in its configuration. The agent
              cannot answer until then.
            </span>
          </MessageContainer.Description>
        </MessageContainer>
      )}
      {status.data?.dynatrace.status && status.data.dynatrace.status !== "connected" && (
        <MessageContainer variant="warning">
          <MessageContainer.Description>
            <span>
              Dynatrace connection: unavailable. {status.data.dynatrace.detail ?? ""} The agent can still run, but Dynatrace queries will
              fail until the runtime can authenticate.
            </span>
          </MessageContainer.Description>
        </MessageContainer>
      )}

      <PromptCards
        selected={selected}
        onPick={(p) => {
          setSelected(p.id);
          setPrompt(p.text);
        }}
      />

      <form
        aria-label="Start an investigation"
        className="rk-card rk-composer"
        onSubmit={(e) => {
          e.preventDefault();
          if (prompt.trim() && connectionRef && !status.error) setStarting(true);
        }}
      >
        <FormField>
          <Label>Command</Label>
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
        <div className="rk-composer__foot">
          <p className="rk-small">
            <span className="rk-kbd">Ctrl</span> + <span className="rk-kbd">Enter</span> also starts.
            {ephemeral.data ? ` ${ephemeral.data.length} ephemeral session(s) in this runtime.` : ""}
          </p>
          <Button type="submit" variant="accent" color="primary" disabled={!prompt.trim() || !connectionRef || Boolean(status.error)}>
            <Button.Prefix>
              <PlayIcon />
            </Button.Prefix>
            Let’s Rock
          </Button>
        </div>
      </form>

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
