import { Button } from "@dynatrace/strato-components/buttons";
import { Markdown, MessageContainer, ProgressCircle } from "@dynatrace/strato-components/content";
import { Checkbox, FormField, Label, TextInput } from "@dynatrace/strato-components/forms";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Modal } from "@dynatrace/strato-components/overlays";
import { Code, Paragraph, Strong } from "@dynatrace/strato-components/typography";
import React, { useEffect, useState } from "react";
import type { ConnectionRef } from "../models/connection";
import type { SavePreview } from "../models/history";
import { errorMessage } from "../services/functions";
import { historyApi } from "../services/history";

export interface SavePreviewModalProps {
  show: boolean;
  connection: ConnectionRef;
  sessionId: string;
  onClose: () => void;
  onSaved: (savedId: string) => void;
}

// Save to Dynatrace: export → redact → preview → explicit confirmation → upload.
export function SavePreviewModal({ show, connection, sessionId, onClose, onSaved }: SavePreviewModalProps) {
  const [preview, setPreview] = useState<SavePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    setReviewed(false);
    try {
      const p = await historyApi.preview(connection, sessionId);
      setPreview(p);
      setTitle(p.title);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (show) void load();
    else setPreview(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, sessionId]);

  const save = async () => {
    if (!preview) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await historyApi.save(connection, sessionId, title.trim(), preview.sha256);
      onSaved(saved.savedId);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Save to Dynatrace"
      show={show}
      onDismiss={saving ? undefined : onClose}
      size="large"
      footer={
        <Flex justifyContent="flex-end" gap={8}>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void load()} disabled={loading || saving}>
            Refresh preview
          </Button>
          <Button
            variant="emphasized"
            color="primary"
            disabled={!preview || !reviewed || !title.trim() || saving}
            loading={saving}
            onClick={() => void save()}
          >
            Save
          </Button>
        </Flex>
      }
    >
      <Flex flexDirection="column" gap={12}>
        <Paragraph>
          Only the user-visible conversation is saved, as an <Strong>immutable</Strong> snapshot in Grail Resource Store. Hidden model
          reasoning is excluded, long tool output is truncated, and secrets are replaced with <Code>[REDACTED]</Code>. Afterwards you
          can rename it or delete it permanently, but not edit it.
        </Paragraph>
        {loading && <ProgressCircle aria-label="Preparing preview" />}
        {preview && (
          <>
            <Paragraph style={{ fontSize: 12 }}>
              {preview.messageCount} messages · {preview.characters.toLocaleString("en-US")} characters · {preview.redactions} redaction(s) · SHA-256{" "}
              <Code>{preview.sha256.slice(0, 16)}…</Code>
            </Paragraph>
            <FormField required>
              <Label>Title</Label>
              <TextInput value={title} onChange={(v) => setTitle(v)} maxLength={200} />
            </FormField>
            <div
              aria-label="Markdown preview"
              tabIndex={0}
              style={{ maxHeight: 420, overflowY: "auto", border: "1px solid currentColor", borderRadius: 8, padding: 12, opacity: 0.95 }}
            >
              <Markdown>{preview.markdown}</Markdown>
            </div>
            <Checkbox value={reviewed} onChange={(v) => setReviewed(v)}>
              I reviewed the preview and want to save this conversation to Dynatrace.
            </Checkbox>
          </>
        )}
        {error && <MessageContainer variant="critical">{error}</MessageContainer>}
      </Flex>
    </Modal>
  );
}
