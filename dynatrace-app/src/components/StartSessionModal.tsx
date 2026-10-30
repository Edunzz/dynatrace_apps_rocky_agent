import { Button } from "@dynatrace/strato-components/buttons";
import { Accordion, Markdown, MessageContainer, ProgressCircle } from "@dynatrace/strato-components/content";
import { Checkbox, FormField, Label, TextArea, TextInput } from "@dynatrace/strato-components/forms";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Modal } from "@dynatrace/strato-components/overlays";
import { Code, Paragraph, Text } from "@dynatrace/strato-components/typography";
import { FieldHint } from "./FieldHint";
import React, { useEffect, useMemo, useState } from "react";
import type { ConnectionRef } from "../models/connection";
import type { RuntimePolicy } from "../models/runtime";
import { errorMessage, RockyError } from "../services/functions";
import { policyDefaultsApi } from "../services/policyDefaults";
import { runtimeApi } from "../services/runtime";
import { findWeakeningStatements, MAX_OVERLAY_CHARS } from "../utils/policy";

export interface StartSessionModalProps {
  show: boolean;
  connection: ConnectionRef;
  prompt: string;
  onClose: () => void;
  onStarted: (sessionId: string) => void;
}

function defaultTitle(prompt: string): string {
  const firstLine = prompt.trim().split(/\r?\n/)[0] ?? "";
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine || "New session";
}

// Shows the effective AGENTS.md before a session starts: the protected
// baseline (read-only) plus an optional additive overlay the user can edit.
export function StartSessionModal({ show, connection, prompt, onClose, onStarted }: StartSessionModalProps) {
  const api = useMemo(() => runtimeApi(connection), [connection]);
  const [policy, setPolicy] = useState<RuntimePolicy | null>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [overlay, setOverlay] = useState("");
  const [saveDefault, setSaveDefault] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!show) return;
    setTitle(defaultTitle(prompt));
    setError(null);
    setSaveDefault(false);
    let cancelled = false;
    api
      .policy()
      .then((p) => !cancelled && setPolicy(p))
      .catch((e: unknown) => !cancelled && setPolicyError(errorMessage(e)));
    policyDefaultsApi.load().then((value) => !cancelled && setOverlay(value)).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [show, prompt, api]);

  const findings = useMemo(() => findWeakeningStatements(overlay), [overlay]);
  const canStart = !busy && prompt.trim().length > 0 && findings.length === 0 && overlay.length <= MAX_OVERLAY_CHARS && title.trim().length > 0;

  const start = async () => {
    setBusy(true);
    setError(null);
    let sessionId: string | null = null;
    try {
      const session = await api.createSession(title.trim());
      sessionId = session.id;
      if (overlay.trim()) {
        try {
          await api.setSessionPolicy(session.id, overlay);
        } catch (e) {
          // Never start a session whose policy did not apply.
          await api.deleteSession(session.id).catch(() => undefined);
          sessionId = null;
          throw e;
        }
      }
      if (saveDefault) await policyDefaultsApi.save(overlay);
      await api.prompt(session.id, prompt.trim());
      onStarted(session.id);
    } catch (e) {
      const details = e instanceof RockyError && Array.isArray(e.details) ? (e.details as { line: number; reason: string }[]) : [];
      setError(`${errorMessage(e)}${details.length ? ` (${details.map((d) => `line ${d.line}: ${d.reason}`).join("; ")})` : ""}`);
      if (sessionId) onStarted(sessionId);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Start a Rocky Agent session"
      show={show}
      onDismiss={busy ? undefined : onClose}
      size="large"
      footer={
        <Flex justifyContent="flex-end" gap={8}>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="accent" color="primary" onClick={() => void start()} disabled={!canStart} loading={busy}>
            Let’s Rock
          </Button>
        </Flex>
      }
    >
      <Flex flexDirection="column" gap={16}>
        <FormField required>
          <Label>Session title</Label>
          <TextInput value={title} onChange={(v) => setTitle(v)} maxLength={200} />
        </FormField>

        <section aria-label="First prompt">
          <Label>First prompt</Label>
          <Paragraph style={{ whiteSpace: "pre-wrap" }}>{prompt}</Paragraph>
        </section>

        <Accordion>
          <Accordion.Section id="baseline-policy">
            <Accordion.SectionLabel>Protected baseline policy (read-only)</Accordion.SectionLabel>
            <Accordion.SectionContent>
              {policyError ? (
                <MessageContainer variant="warning">
                  <MessageContainer.Description>
                    The baseline could not be loaded ({policyError}). It still applies inside the runtime.
                  </MessageContainer.Description>
                </MessageContainer>
              ) : !policy ? (
                <ProgressCircle size="small" aria-label="Loading policy" />
              ) : (
                <div style={{ maxHeight: 320, overflowY: "auto" }}>
                  <Text style={{ fontSize: 12 }}>
                    SHA-256 <Code>{policy.baselineSha256.slice(0, 16)}…</Code> · always applied, cannot be weakened
                  </Text>
                  <Markdown>{policy.baseline}</Markdown>
                </div>
              )}
            </Accordion.SectionContent>
          </Accordion.Section>
        </Accordion>

        <FormField>
          <Label>Your additions (optional)</Label>
          <TextArea
            value={overlay}
            onChange={(v) => setOverlay(v)}
            rows={6}
            resize="vertical"
            placeholder={"Examples:\nAnswer in Spanish.\nOnly analyze services tagged team:payments.\nNever modify dashboards owned by other teams."}
          />
          <FieldHint>
            Add restrictions or clarifications. Secret protection, explicit confirmation, destructive-action limits and audit can’t be
            removed. Kept in the runtime for this session only. {overlay.length.toLocaleString("en-US")}/{MAX_OVERLAY_CHARS.toLocaleString("en-US")}
          </FieldHint>
        </FormField>
        {findings.length > 0 && (
          <MessageContainer variant="critical">
            <MessageContainer.Title>These lines would weaken the protected baseline</MessageContainer.Title>
            <MessageContainer.Description>
              {findings.map((f) => `Line ${f.line} ${f.reason}: “${f.text}”`).join(" ")}
            </MessageContainer.Description>
          </MessageContainer>
        )}
        <Checkbox value={saveDefault} onChange={(v) => setSaveDefault(v)} disabled={!overlay.trim()}>
          Save as my default policy (stored in my own user app state)
        </Checkbox>
        {error && (
          <MessageContainer variant="critical">
            <MessageContainer.Description>{error}</MessageContainer.Description>
          </MessageContainer>
        )}
      </Flex>
    </Modal>
  );
}
