import { Button } from "@dynatrace/strato-components/buttons";
import { Chip, MessageContainer, ProgressCircle } from "@dynatrace/strato-components/content";
import { FormField, Label, TextArea, TextInput } from "@dynatrace/strato-components/forms";
import { showToast } from "@dynatrace/strato-components/notifications";
import { DeleteIcon, DocumentIcon, DocumentStackIcon, EditIcon, FormatListNumberedIcon, SaveIcon, StopIcon } from "@dynatrace/strato-icons";
import React, { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useConnection } from "../app/ConnectionContext";
import { useRuntimeData } from "../app/RuntimeDataContext";
import { MessageTimeline } from "../components/MessageTimeline";
import { ConfirmModal } from "../components/modals";
import { PasswordPrompt } from "../components/PasswordPrompt";
import { PermissionCard } from "../components/PermissionCard";
import { SavePreviewModal } from "../components/SavePreviewModal";
import { SessionPolicyModal } from "../components/SessionPolicyModal";
import { useSessionChat } from "../hooks/useSessionChat";
import { errorMessage } from "../services/functions";
import { type Artifact, runtimeApi, type Todo } from "../services/runtime";

export function SessionPage() {
  const { sessionId = "" } = useParams();
  const navigate = useNavigate();
  const { active, connectionRef, needsPassword, loading } = useConnection();
  const { ephemeral, saved } = useRuntimeData();
  const api = useMemo(() => (connectionRef ? runtimeApi(connectionRef) : null), [connectionRef]);
  const chat = useSessionChat(connectionRef, sessionId);

  const session = ephemeral.data?.find((s) => s.id === sessionId);
  const [title, setTitle] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [modal, setModal] = useState<"save" | "delete" | "policy" | null>(null);

  useEffect(() => {
    if (!editingTitle) setTitle(session?.title ?? "");
  }, [session?.title, editingTitle]);

  // Refresh task status and artifacts whenever the agent finishes a turn.
  useEffect(() => {
    if (!api || !sessionId || chat.busy || !chat.initialized) return;
    api.todo(sessionId).then(setTodos).catch(() => setTodos([]));
    api.artifacts(sessionId).then(setArtifacts).catch(() => setArtifacts([]));
  }, [api, sessionId, chat.busy, chat.initialized]);

  if (!loading && !active) return <Navigate to="/connect" replace />;

  const statusChip =
    chat.status.type === "busy" ? (
      <Chip color="primary">Working</Chip>
    ) : chat.status.type === "retry" ? (
      <Chip color="warning">Retrying: {chat.status.message}</Chip>
    ) : (
      <Chip color="success">Idle</Chip>
    );

  const send = async () => {
    const text = input.trim();
    if (!text) return;
    setSending(true);
    setActionError(null);
    try {
      await chat.send(text);
      setInput("");
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="rk-page rk-page--wide">
      {needsPassword && <PasswordPrompt />}

      <header className="rk-card rk-stack">
        <div className="rk-row" style={{ gap: 12 }}>
          {editingTitle ? (
            <form
              aria-label="Session title"
              style={{ display: "flex", gap: 8, flex: "1 1 320px" }}
              onSubmit={(e) => {
                e.preventDefault();
                if (!api || !title.trim()) return;
                api
                  .renameSession(sessionId, title.trim())
                  .then(() => {
                    setEditingTitle(false);
                    ephemeral.refresh();
                  })
                  .catch((err: unknown) => setActionError(errorMessage(err)));
              }}
            >
              <FormField style={{ flex: 1 }}>
                <Label>Session title</Label>
                <TextInput value={title} onChange={(v) => setTitle(v)} maxLength={200} />
              </FormField>
              <Button type="submit" variant="emphasized" color="primary" style={{ alignSelf: "flex-end" }}>
                Save
              </Button>
              <Button onClick={() => setEditingTitle(false)} style={{ alignSelf: "flex-end" }}>
                Cancel
              </Button>
            </form>
          ) : (
            <div className="rk-row" style={{ flex: "1 1 320px" }}>
              <h1 className="rk-subtitle">{session?.title || "Session"}</h1>
              <Button size="condensed" onClick={() => setEditingTitle(true)}>
                <Button.Prefix>
                  <EditIcon />
                </Button.Prefix>
                Rename
              </Button>
            </div>
          )}
          {statusChip}
          <Chip color="warning">Ephemeral</Chip>
        </div>
        <div className="rk-row">
          <Button variant="emphasized" color="primary" disabled={!connectionRef} onClick={() => setModal("save")}>
            <Button.Prefix>
              <SaveIcon />
            </Button.Prefix>
            Save to Dynatrace
          </Button>
          <Button onClick={() => setModal("policy")} disabled={!api}>
            Policy
          </Button>
          <span className="rk-spacer" />
          <Button color="critical" disabled={!chat.busy} onClick={() => void chat.stopGeneration().catch((e: unknown) => setActionError(errorMessage(e)))}>
            <Button.Prefix>
              <StopIcon />
            </Button.Prefix>
            Stop generation
          </Button>
          <Button color="critical" onClick={() => setModal("delete")} disabled={!api}>
            <Button.Prefix>
              <DeleteIcon />
            </Button.Prefix>
            Delete ephemeral session
          </Button>
        </div>
        {actionError && (
          <MessageContainer variant="critical">
            <MessageContainer.Description>{actionError}</MessageContainer.Description>
          </MessageContainer>
        )}
      </header>

      <div className="rk-session-grid">
        <section aria-label="Activity" className="rk-card rk-chat" style={{ minHeight: 240 }}>
          <div className="rk-section-head">
            <p className="rk-eyebrow">Activity</p>
            {chat.busy && <ProgressCircle size="small" aria-label="Agent working" />}
          </div>
          {!chat.initialized && chat.polling ? <ProgressCircle aria-label="Loading conversation" /> : <MessageTimeline messages={chat.messages} busy={chat.busy} />}
          {chat.error ? (
            <MessageContainer variant="critical" style={{ marginTop: 12 }}>
              <MessageContainer.Description>
                <span>
                  {errorMessage(chat.error)} {chat.polling ? "Retrying…" : ""}
                </span>
              </MessageContainer.Description>
            </MessageContainer>
          ) : null}
          {(chat.stalled || (!chat.polling && chat.initialized)) && (
            <MessageContainer variant="warning" style={{ marginTop: 12 }}>
              <MessageContainer.Description>
                {chat.stalled ? "No progress for 10 minutes; live updates paused." : "Live updates paused."}
              </MessageContainer.Description>
              <MessageContainer.Actions>
                <Button onClick={() => chat.resume()}>Resume updates</Button>
              </MessageContainer.Actions>
            </MessageContainer>
          )}
        </section>

        <aside className="rk-rail">
          <section aria-label="Current task status" className="rk-card rk-card--compact">
            <div className="rk-section-head">
              <FormatListNumberedIcon />
              <p className="rk-eyebrow">Tasks</p>
            </div>
            {todos.length === 0 ? (
              <p className="rk-small">No task list for this session.</p>
            ) : (
              <ul className="rk-list">
                {todos.map((t, i) => (
                  <li key={t.id ?? i} className="rk-task" data-status={t.status}>
                    <span className="rk-task__mark" aria-hidden="true" />
                    <span>
                      <span className="rk-sr">{t.status}: </span>
                      {t.content}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-label="Artifacts" className="rk-card rk-card--compact">
            <div className="rk-section-head">
              <DocumentStackIcon />
              <p className="rk-eyebrow">Artifacts</p>
            </div>
            {artifacts.length === 0 ? (
              <p className="rk-small">The agent has not written any files in this session yet.</p>
            ) : (
              <ul className="rk-list">
                {artifacts.map((a) => (
                  <li key={a.file} className="rk-file">
                    <DocumentIcon />
                    {a.file}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>

      {chat.permissions.map((p) => (
        <PermissionCard key={p.id} request={p} onReply={chat.replyPermission} />
      ))}

      <form
        aria-label="Send a prompt"
        className="rk-card rk-composer rk-sticky"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <FormField>
          <Label>Message</Label>
          <TextArea
            value={input}
            onChange={(v) => setInput(v)}
            rows={3}
            resize="vertical"
            placeholder="Ask a follow-up, answer the agent, or confirm with: CONFIRM: Execute the described change"
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                void send();
              }
            }}
          />
        </FormField>
        <div className="rk-composer__foot">
          <p className="rk-small">
            <span className="rk-kbd">Ctrl</span> + <span className="rk-kbd">Enter</span> sends.
          </p>
          <Button type="submit" variant="emphasized" color="primary" loading={sending} disabled={!input.trim() || sending || !connectionRef}>
            Send ›
          </Button>
        </div>
      </form>

      {connectionRef && (
        <SavePreviewModal
          show={modal === "save"}
          connection={connectionRef}
          sessionId={sessionId}
          onClose={() => setModal(null)}
          onSaved={(savedId) => {
            setModal(null);
            saved.refresh();
            showToast({ type: "success", title: "Saved to Dynatrace", message: "The conversation is stored as an immutable snapshot." });
            navigate(`/saved/${encodeURIComponent(savedId)}`);
          }}
        />
      )}
      {api && (
        <SessionPolicyModal show={modal === "policy"} api={api} sessionId={sessionId} onClose={() => setModal(null)} />
      )}
      <ConfirmModal
        show={modal === "delete"}
        title="Delete ephemeral session"
        critical
        confirmLabel="Delete session"
        message="This removes the session from the runtime. Unless you saved it to Dynatrace, it cannot be recovered."
        onClose={() => setModal(null)}
        onConfirm={async () => {
          if (!api) return;
          await api.deleteSession(sessionId);
          ephemeral.refresh();
          navigate("/agent");
        }}
      />
    </div>
  );
}
