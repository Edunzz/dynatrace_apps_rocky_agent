import { Button } from "@dynatrace/strato-components/buttons";
import { Chip, MessageContainer, ProgressCircle } from "@dynatrace/strato-components/content";
import { SearchInput } from "@dynatrace/strato-components/forms";
import { Heading } from "@dynatrace/strato-components/typography";
import { DeleteIcon, EditIcon, PlusIcon } from "@dynatrace/strato-icons";
import React, { useMemo, useState } from "react";
import { useMatch, useNavigate } from "react-router-dom";
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

export function SessionSidebar() {
  const navigate = useNavigate();
  // The sidebar renders outside <Routes>, so it reads the ids from the URL.
  const params = {
    savedId: useMatch("/saved/:savedId")?.params.savedId,
    sessionId: useMatch("/agent/session/:sessionId")?.params.sessionId,
  };
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
    <nav aria-label="Sessions" className="rk-side">
      <Button variant="emphasized" color="primary" width="full" disabled={!connectionRef} onClick={() => navigate("/agent")}>
        <Button.Prefix>
          <PlusIcon />
        </Button.Prefix>
        New session
      </Button>

      <section aria-labelledby="saved-heading">
        <div className="rk-side__head">
          <Heading level={6} id="saved-heading">
            Saved in Dynatrace
          </Heading>
          {saved.loading && <ProgressCircle size="small" aria-label="Loading saved sessions" />}
        </div>
        <p className="rk-side__hint">Immutable snapshots in Grail Resource Store.</p>
        <SearchInput value={query} onChange={(value) => setQuery(value)} placeholder="Search saved sessions" aria-label="Search saved sessions" />
        {saved.error ? (
          <MessageContainer variant="critical">
            <MessageContainer.Description>{errorMessage(saved.error)}</MessageContainer.Description>
          </MessageContainer>
        ) : filteredSaved.length === 0 ? (
          <p className="rk-side__empty">{query ? "No matches." : "No saved sessions yet."}</p>
        ) : (
          <ul className="rk-side__list">
            {filteredSaved.map((s) => (
              <li key={s.savedId} className="rk-side__row">
                <button
                  type="button"
                  className="rk-side__item"
                  title={s.title}
                  onClick={() => navigate(`/saved/${encodeURIComponent(s.savedId)}`)}
                  aria-current={params.savedId === s.savedId ? "page" : undefined}
                >
                  <span className="rk-side__title">{s.title}</span>
                  <span className="rk-side__date">{formatDate(s.savedAt)}</span>
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

      <section aria-labelledby="ephemeral-heading">
        <div className="rk-side__head">
          <Heading level={6} id="ephemeral-heading">
            Runtime sessions
          </Heading>
          <Chip color="warning" size="condensed">
            Temporary
          </Chip>
        </div>
        <p className="rk-side__hint">
          These live only inside the runtime container and disappear if the runtime is destroyed. Use “Save to Dynatrace” to keep
          a conversation.
        </p>
        {!connectionRef ? (
          <p className="rk-side__empty">Connect a runtime to see its sessions.</p>
        ) : ephemeral.error ? (
          <MessageContainer variant="critical">
            <MessageContainer.Description>{errorMessage(ephemeral.error)}</MessageContainer.Description>
          </MessageContainer>
        ) : (ephemeral.data ?? []).length === 0 ? (
          <p className="rk-side__empty">No sessions in this runtime.</p>
        ) : (
          <ul className="rk-side__list">
            {(ephemeral.data ?? []).map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className="rk-side__item"
                  title={s.title || "Untitled session"}
                  onClick={() => navigate(`/agent/session/${encodeURIComponent(s.id)}`)}
                  aria-current={params.sessionId === s.id ? "page" : undefined}
                >
                  <span className="rk-side__title">{s.title || "Untitled session"}</span>
                  <span className="rk-side__date">{formatDate(s.time?.updated)}</span>
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
