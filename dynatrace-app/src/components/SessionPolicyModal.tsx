import { Button } from "@dynatrace/strato-components/buttons";
import { MessageContainer } from "@dynatrace/strato-components/content";
import { FormField, Label, TextArea } from "@dynatrace/strato-components/forms";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Modal } from "@dynatrace/strato-components/overlays";
import { FieldHint } from "./FieldHint";
import React, { useEffect, useMemo, useState } from "react";
import type { RuntimeApi } from "../services/runtime";
import { errorMessage } from "../services/functions";
import { findWeakeningStatements } from "../utils/policy";

export function SessionPolicyModal({ show, api, sessionId, onClose }: { show: boolean; api: RuntimeApi; sessionId: string; onClose: () => void }) {
  const [overlay, setOverlay] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!show) return;
    setError(null);
    api
      .getSessionPolicy(sessionId)
      .then((p) => setOverlay(p.overlay))
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [show, api, sessionId]);

  const findings = useMemo(() => findWeakeningStatements(overlay), [overlay]);

  return (
    <Modal
      title="Session policy additions"
      show={show}
      onDismiss={onClose}
      size="medium"
      footer={
        <Flex justifyContent="flex-end" gap={8}>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="emphasized"
            color="primary"
            loading={busy}
            disabled={busy || findings.length > 0}
            onClick={() => {
              setBusy(true);
              api
                .setSessionPolicy(sessionId, overlay)
                .then(onClose)
                .catch((e: unknown) => setError(errorMessage(e)))
                .finally(() => setBusy(false));
            }}
          >
            Apply to next prompts
          </Button>
        </Flex>
      }
    >
      <Flex flexDirection="column" gap={12}>
        <FormField>
          <Label>Additional instructions</Label>
          <TextArea value={overlay} onChange={(v) => setOverlay(v)} rows={8} resize="vertical" />
          <FieldHint>Applied after the protected baseline to the next prompts in this session. Kept in runtime memory only.</FieldHint>
        </FormField>
        {findings.length > 0 && (
          <MessageContainer variant="critical">{findings.map((f) => `Line ${f.line} ${f.reason}.`).join(" ")}</MessageContainer>
        )}
        {error && <MessageContainer variant="critical">{error}</MessageContainer>}
      </Flex>
    </Modal>
  );
}
