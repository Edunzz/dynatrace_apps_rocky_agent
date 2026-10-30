import { Button } from "@dynatrace/strato-components/buttons";
import { Chip, Markdown, MessageContainer, ProgressCircle } from "@dynatrace/strato-components/content";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Code } from "@dynatrace/strato-components/typography";
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
    <div className="rk-page rk-page--narrow">
      {error && (
        <MessageContainer variant="critical">
          <MessageContainer.Description>{error}</MessageContainer.Description>
        </MessageContainer>
      )}
      {!detail && !error && <ProgressCircle aria-label="Loading saved session" />}
      {detail && (
        <>
          <header className="rk-card rk-stack">
            <div className="rk-row" style={{ gap: 12 }}>
              <h1 className="rk-subtitle" style={{ flex: "1 1 320px" }}>
                {detail.title}
              </h1>
              <Chip color="neutral">Saved in Dynatrace</Chip>
              {detail.integrityVerified ? (
                <Chip color="success">Integrity verified</Chip>
              ) : (
                <Chip color="critical">Integrity check failed</Chip>
              )}
            </div>
            <p className="rk-small">
              Saved {new Date(detail.savedAt).toLocaleString()} · model {detail.modelProvider || "unknown"}/{detail.modelId || "unknown"} ·
              SHA-256 <Code>{detail.contentSha256.slice(0, 16)}…</Code>
            </p>
            <p className="rk-small">Immutable snapshot: the content cannot be edited. You can rename the display title or delete it permanently.</p>
            <Flex gap={8} flexWrap="wrap">
              <Button onClick={() => setModal("rename")}>Rename</Button>
              <Button onClick={() => download(detail.title, detail.markdown)}>Download Markdown</Button>
              <Button color="critical" onClick={() => setModal("delete")}>
                Delete permanently
              </Button>
            </Flex>
          </header>
          <article className="rk-card rk-chat">
            <Markdown>{detail.markdown}</Markdown>
          </article>
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
    </div>
  );
}
