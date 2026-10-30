import { Button } from "@dynatrace/strato-components/buttons";
import { Chip, MessageContainer, ProgressCircle } from "@dynatrace/strato-components/content";
import { SearchInput } from "@dynatrace/strato-components/forms";
import { Divider, Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Paragraph, Text } from "@dynatrace/strato-components/typography";
import { DeleteIcon, EditIcon } from "@dynatrace/strato-icons";
import React, { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useConnection } from "../app/ConnectionContext";
import { useRuntimeData } from "../app/RuntimeDataContext";
import type { SavedSessionSummary } from "../models/history";
import { errorMessage } from "../services/functions";
import { historyApi } from "../services/history";
import { ConfirmDeleteModal, RenameModal } from "./modals";

function formatDate(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

const itemStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid transparent",
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
  font: "inherit",
};

export function SessionSidebar() {
  const navigate = useNavigate();
  const params = useParams();
  const { connectionRef } = useConnection();
  const { saved, ephemeral } = useRuntimeData();
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<SavedSessionSummary | null>(null);
  const [deleting, setDeleting] = useState<SavedSessionSummary | null>(null);

  const filteredSaved = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (saved.data ?? []).filter((s) => !q || s.title.toLowerCase().includes(q));
  }, [saved.data, query]);

  return (
    <nav aria-label="Sessions" style={{ display: "flex", flexDirection: "column", gap: 12, padding: 12, height: "100%", overflowY: "auto" }}>
      <section aria-labelledby="saved-heading">
        <Flex alignItems="center" justifyContent="space-between">
          <Heading level={6} id="saved-heading">
            Saved in Dynatrace
          </Heading>
          {saved.loading && <ProgressCircle size="small" aria-label="Loading saved sessions" />}
        </Flex>
        <Paragraph style={{ fontSize: 12, opacity: 0.8 }}>Immutable snapshots in Grail Resource Store.</Paragraph>
        <SearchInput value={query} onChange={(value) => setQuery(value)} placeholder="Search saved sessions" aria-label="Search saved sessions" />
        {saved.error ? (
          <MessageContainer variant="critical">{errorMessage(saved.error)}</MessageContainer>
        ) : filteredSaved.length === 0 ? (
          <Paragraph style={{ fontSize: 12, marginTop: 8 }}>{query ? "No matches." : "No saved sessions yet."}</Paragraph>
        ) : (
          <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0 }}>
            {filteredSaved.map((s) => (
              <li key={s.savedId} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <button
                  type="button"
                  style={{ ...itemStyle, borderColor: params.savedId === s.savedId ? "currentColor" : "transparent" }}
                  onClick={() => navigate(`/saved/${encodeURIComponent(s.savedId)}`)}
                  aria-current={params.savedId === s.savedId ? "page" : undefined}
                >
                  <Text style={{ display: "block", fontWeight: 600 }}>{s.title}</Text>
                  <Text style={{ fontSize: 11, opacity: 0.75 }}>{formatDate(s.savedAt)}</Text>
                </button>
                <Button size="condensed" aria-label={`Rename ${s.title}`} onClick={() => setRenaming(s)}>
                  <Button.Prefix>
                    <EditIcon />
                  </Button.Prefix>
                </Button>
                <Button size="condensed" color="critical" aria-label={`Delete ${s.title}`} onClick={() => setDeleting(s)}>
                  <Button.Prefix>
                    <DeleteIcon />
                  </Button.Prefix>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Divider />

      <section aria-labelledby="ephemeral-heading">
        <Flex alignItems="center" justifyContent="space-between">
          <Heading level={6} id="ephemeral-heading">
            Ephemeral runtime sessions
          </Heading>
          <Chip color="warning" size="condensed">
            Temporary
          </Chip>
        </Flex>
        <Paragraph style={{ fontSize: 12, opacity: 0.8 }}>
          These live only inside the runtime container and disappear if the runtime is destroyed. Use “Save to Dynatrace” to keep
          a conversation.
        </Paragraph>
        {!connectionRef ? (
          <Paragraph style={{ fontSize: 12 }}>Connect a runtime to see its sessions.</Paragraph>
        ) : ephemeral.error ? (
          <MessageContainer variant="critical">{errorMessage(ephemeral.error)}</MessageContainer>
        ) : (ephemeral.data ?? []).length === 0 ? (
          <Paragraph style={{ fontSize: 12 }}>No sessions in this runtime.</Paragraph>
        ) : (
          <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0 }}>
            {(ephemeral.data ?? []).map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  style={{ ...itemStyle, borderColor: params.sessionId === s.id ? "currentColor" : "transparent" }}
                  onClick={() => navigate(`/agent/session/${encodeURIComponent(s.id)}`)}
                  aria-current={params.sessionId === s.id ? "page" : undefined}
                >
                  <Text style={{ display: "block", fontWeight: 600 }}>{s.title || "Untitled session"}</Text>
                  <Text style={{ fontSize: 11, opacity: 0.75 }}>{formatDate(s.time?.updated)}</Text>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <RenameModal
        show={renaming !== null}
        currentTitle={renaming?.title ?? ""}
        description="Only the display title changes. The saved conversation stays exactly as it was saved."
        onClose={() => setRenaming(null)}
        onSave={async (title) => {
          if (!renaming) return;
          await historyApi.rename(renaming.savedId, title);
          saved.refresh();
        }}
      />
      <ConfirmDeleteModal
        show={deleting !== null}
        title="Delete saved session"
        itemName={deleting?.title ?? ""}
        onClose={() => setDeleting(null)}
        onConfirm={async (confirmation) => {
          if (!deleting) return;
          const id = deleting.savedId;
          await historyApi.remove(id, confirmation);
          saved.refresh();
          if (params.savedId === id) navigate("/agent");
        }}
      />
    </nav>
  );
}
