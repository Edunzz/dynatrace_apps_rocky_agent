import { Button } from "@dynatrace/strato-components/buttons";
import { Chip, Markdown, MessageContainer, ProgressCircle } from "@dynatrace/strato-components/content";
import { Flex, Surface } from "@dynatrace/strato-components/layouts";
import { Code, Heading, Paragraph, Text } from "@dynatrace/strato-components/typography";
import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useRuntimeData } from "../app/RuntimeDataContext";
import { ConfirmDeleteModal, RenameModal } from "../components/modals";
import type { SavedSessionDetail } from "../models/history";
import { errorMessage } from "../services/functions";
import { historyApi } from "../services/history";

function download(name: string, markdown: string) {
  const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 80) || "rocky-session"}.md`;
  link.click();
  URL.revokeObjectURL(url);
}

export function SavedSessionPage() {
  const { savedId = "" } = useParams();
  const navigate = useNavigate();
  const { saved } = useRuntimeData();
  const [detail, setDetail] = useState<SavedSessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<"rename" | "delete" | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setDetail(await historyApi.read(savedId));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [savedId]);

  useEffect(() => {
    setDetail(null);
    void load();
  }, [load]);

  return (
    <Flex flexDirection="column" gap={16} padding={24} style={{ maxWidth: 1100, margin: "0 auto" }}>
      {error && (
        <MessageContainer variant="critical">
          <MessageContainer.Description>{error}</MessageContainer.Description>
        </MessageContainer>
      )}
      {!detail && !error && <ProgressCircle aria-label="Loading saved session" />}
      {detail && (
        <>
          <Flex alignItems="center" gap={12} flexWrap="wrap">
            <Heading level={2} style={{ flex: "1 1 320px", overflowWrap: "anywhere" }}>
              {detail.title}
            </Heading>
            <Chip color="neutral">Saved in Dynatrace</Chip>
            {detail.integrityVerified ? (
              <Chip color="success">Integrity verified</Chip>
            ) : (
              <Chip color="critical">Integrity check failed</Chip>
            )}
          </Flex>
          <Paragraph style={{ fontSize: 13 }}>
            Saved {new Date(detail.savedAt).toLocaleString()} · model {detail.modelProvider || "unknown"}/{detail.modelId || "unknown"} ·
            SHA-256 <Code>{detail.contentSha256.slice(0, 16)}…</Code>
          </Paragraph>
          <Text style={{ fontSize: 12, opacity: 0.85 }}>
            Immutable snapshot: the content cannot be edited. You can rename the display title or delete it permanently.
          </Text>
          <Flex gap={8} flexWrap="wrap">
            <Button onClick={() => setModal("rename")}>Rename</Button>
            <Button onClick={() => download(detail.title, detail.markdown)}>Download Markdown</Button>
            <Button color="critical" onClick={() => setModal("delete")}>
              Delete permanently
            </Button>
          </Flex>
          <Surface padding={16}>
            <Markdown>{detail.markdown}</Markdown>
          </Surface>
          <RenameModal
            show={modal === "rename"}
            currentTitle={detail.title}
            description="Only the display title changes. The saved conversation stays exactly as it was saved."
            onClose={() => setModal(null)}
            onSave={async (title) => {
              await historyApi.rename(detail.savedId, title);
              saved.refresh();
              await load();
            }}
          />
          <ConfirmDeleteModal
            show={modal === "delete"}
            title="Delete saved session"
            itemName={detail.title}
            onClose={() => setModal(null)}
            onConfirm={async (confirmation) => {
              await historyApi.remove(detail.savedId, confirmation);
              saved.refresh();
              navigate("/agent");
            }}
          />
        </>
      )}
    </Flex>
  );
}
