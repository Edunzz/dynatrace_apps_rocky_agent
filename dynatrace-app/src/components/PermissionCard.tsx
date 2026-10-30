import { Button } from "@dynatrace/strato-components/buttons";
import { MessageContainer } from "@dynatrace/strato-components/content";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Code, Paragraph, Strong } from "@dynatrace/strato-components/typography";
import React, { useState } from "react";
import type { OcPermissionRequest } from "../models/runtime";
import { errorMessage } from "../services/functions";

const DESCRIPTIONS: Record<string, string> = {
  bash: "run a shell command",
  edit: "change a file",
  webfetch: "fetch a web page",
  websearch: "search the web",
  external_directory: "access a path outside the workspace",
  doom_loop: "continue a repeated action",
};

export function PermissionCard({
  request,
  onReply,
}: {
  request: OcPermissionRequest;
  onReply: (id: string, reply: "once" | "reject") => Promise<void>;
}) {
  const [busy, setBusy] = useState<"once" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const command = typeof request.metadata?.command === "string" ? request.metadata.command : null;
  const reply = async (value: "once" | "reject") => {
    setBusy(value);
    setError(null);
    try {
      await onReply(request.id, value);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <MessageContainer variant="warning" aria-live="polite">
      <MessageContainer.Title>Permission requested: {DESCRIPTIONS[request.permission] ?? request.permission}</MessageContainer.Title>
      <MessageContainer.Description>
        <Flex flexDirection="column" gap={6}>
          {command && (
            <span>
              <Strong>Command:</Strong> <Code>{command}</Code>
            </span>
          )}
          {!command && request.patterns.length > 0 && (
            <span>
              <Strong>Target:</Strong> <Code>{request.patterns.join(", ")}</Code>
            </span>
          )}
          <Paragraph style={{ fontSize: 12 }}>
            An approval covers this single operation only. Changes to Dynatrace also need the confirmation block described in the
            agent policy.
          </Paragraph>
          {error && <span>{error}</span>}
        </Flex>
      </MessageContainer.Description>
      <MessageContainer.Actions>
        <Button variant="emphasized" color="primary" loading={busy === "once"} disabled={busy !== null} onClick={() => void reply("once")}>
          Approve once
        </Button>
        <Button color="critical" loading={busy === "reject"} disabled={busy !== null} onClick={() => void reply("reject")}>
          Reject
        </Button>
      </MessageContainer.Actions>
    </MessageContainer>
  );
}
