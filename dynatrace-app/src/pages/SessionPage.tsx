import { Button } from "@dynatrace/strato-components/buttons";
import { Chip, MessageContainer, ProgressCircle } from "@dynatrace/strato-components/content";
import { FormField, Label, TextArea, TextInput } from "@dynatrace/strato-components/forms";
import { Flex } from "@dynatrace/strato-components/layouts";
import { showToast } from "@dynatrace/strato-components/notifications";
import { Text } from "@dynatrace/strato-components/typography";
import { DeleteIcon, SaveIcon, StopIcon } from "@dynatrace/strato-icons";
import React, { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useConnection } from "../app/ConnectionContext";
import { useRuntimeData } from "../app/RuntimeDataContext";
import { Console } from "../app/theme";
import { MessageTimeline } from "../components/MessageTimeline";
import { ConfirmModal } from "../components/modals";
import { PasswordPrompt } from "../components/PasswordPrompt";
import { PermissionCard } from "../components/PermissionCard";
import { SavePreviewModal } from "../components/SavePreviewModal";
import { SessionPolicyModal } from "../components/SessionPolicyModal";
import { useSessionChat } from "../hooks/useSessionChat";
import { errorMessage } from "../services/functions";
import { type Artifact, runtimeApi, type Todo } from "../services/runtime";

const panel: React.CSSProperties = {
  background: Console.surface,
  border: `1px solid ${Console.border}`,
  borderRadius: 12,
  padding: 16,
};

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
    <div style={{ minHeight: "100%", background: Console.background, padding: 16 }}>
      <Flex flexDirection="column" gap={16} style={{ maxWidth: 1200, margin: "0 auto" }}>
        {needsPassword && <PasswordPrompt />}

        <div style={panel}>
          <Flex alignItems="center" gap={12} flexWrap="wrap">
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
              <Flex alignItems="center" gap={8} style={{ flex: "1 1 320px", minWidth: 0 }}>
                <h1 style={{ color: Console.text, fontSize: 22, margin: 0, overflowWrap: "anywhere" }}>{session?.title || "Session"}</h1>
                <Button size="condensed" onClick={() => setEditingTitle(true)}>
                  Rename
                </Button>
              </Flex>
            )}
            {statusChip}
            <Chip color="warning">Ephemeral</Chip>
          </Flex>
          <Flex gap={8} flexWrap="wrap" style={{ marginTop: 12 }}>
            <Button color="critical" disabled={!chat.busy} onClick={() => void chat.stopGeneration().catch((e: unknown) => setActionError(errorMessage(e)))}>
              <Button.Prefix>
                <StopIcon />
              </Button.Prefix>
              Stop generation
            </Button>
            <Button variant="emphasized" color="primary" disabled={!connectionRef} onClick={() => setModal("save")}>
              <Button.Prefix>
                <SaveIcon />
              </Button.Prefix>
              Save to Dynatrace
            </Button>
            <Button onClick={() => setModal("policy")} disabled={!api}>
              Policy
            </Button>
            <Button color="critical" onClick={() => setModal("delete")} disabled={!api}>
              <Button.Prefix>
                <DeleteIcon />
              </Button.Prefix>
              Delete ephemeral session
            </Button>
          </Flex>
          {actionError && (
            <MessageContainer variant="critical" style={{ marginTop: 12 }}>
              {actionError}
            </MessageContainer>
          )}
        </div>

        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))" }}>
          <section aria-label="Current task status" style={panel}>
            <Text style={{ color: Console.green, fontFamily: Console.mono, fontSize: 12, letterSpacing: 1 }}>TASKS</Text>
            {todos.length === 0 ? (
              <Text style={{ display: "block", color: Console.muted, fontSize: 13 }}>No task list for this session.</Text>
            ) : (
              <ul style={{ margin: "8px 0 0", paddingLeft: 18, color: Console.text }}>
                {todos.map((t, i) => (
                  <li key={t.id ?? i}>
                    <Text style={{ color: t.status === "completed" ? Console.green : t.status === "in_progress" ? Console.cyan : Console.text }}>
                      [{t.status}] {t.content}
                    </Text>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-label="Artifacts" style={panel}>
            <Text style={{ color: Console.green, fontFamily: Console.mono, fontSize: 12, letterSpacing: 1 }}>ARTIFACTS</Text>
            {artifacts.length === 0 ? (
              <Text style={{ display: "block", color: Console.muted, fontSize: 13 }}>The agent has not written any files in this session yet.</Text>
            ) : (
              <ul style={{ margin: "8px 0 0", paddingLeft: 18, color: Console.text }}>
                {artifacts.map((a) => (
                  <li key={a.file}>
                    <Text style={{ fontFamily: Console.mono, fontSize: 13, color: Console.text }}>
                      {a.file}
                    </Text>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section aria-label="Activity" style={{ ...panel, minHeight: 240 }}>
          <Flex alignItems="center" gap={8} style={{ marginBottom: 12 }}>
            <Text style={{ color: Console.green, fontFamily: Console.mono, fontSize: 12, letterSpacing: 1 }}>ACTIVITY</Text>
            {chat.busy && <ProgressCircle size="small" aria-label="Agent working" />}
          </Flex>
          {!chat.initialized && chat.polling ? <ProgressCircle aria-label="Loading conversation" /> : <MessageTimeline messages={chat.messages} busy={chat.busy} />}
          {chat.error ? (
            <MessageContainer variant="critical" style={{ marginTop: 12 }}>
              {errorMessage(chat.error)} {chat.polling ? "Retrying…" : ""}
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

        {chat.permissions.map((p) => (
          <PermissionCard key={p.id} request={p} onReply={chat.replyPermission} />
        ))}

        <form
          aria-label="Send a prompt"
          style={panel}
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <FormField>
            <Label>
              <span style={{ color: Console.text }}>Message</span>
            </Label>
            <TextArea
              value={input}
              onChange={(v) => setInput(v)}
              rows={4}
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
          <Flex justifyContent="flex-end" style={{ marginTop: 8 }}>
            <Button type="submit" variant="emphasized" color="primary" loading={sending} disabled={!input.trim() || sending || !connectionRef}>
              Send ›
            </Button>
          </Flex>
        </form>
      </Flex>

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
