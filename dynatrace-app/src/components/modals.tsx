import { Button } from "@dynatrace/strato-components/buttons";
import { MessageContainer } from "@dynatrace/strato-components/content";
import { FormField, Label, TextInput } from "@dynatrace/strato-components/forms";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Modal } from "@dynatrace/strato-components/overlays";
import { Paragraph, Strong } from "@dynatrace/strato-components/typography";
import React, { useEffect, useState } from "react";
import { errorMessage } from "../services/functions";
import { DELETE_CONFIRMATION } from "../services/history";

interface ActionState {
  busy: boolean;
  error: string | null;
}

function useAction() {
  const [state, setState] = useState<ActionState>({ busy: false, error: null });
  const run = async (work: () => Promise<void>) => {
    setState({ busy: true, error: null });
    try {
      await work();
      setState({ busy: false, error: null });
      return true;
    } catch (e) {
      setState({ busy: false, error: errorMessage(e) });
      return false;
    }
  };
  return { ...state, run, reset: () => setState({ busy: false, error: null }) };
}

export interface ConfirmDeleteModalProps {
  show: boolean;
  title: string;
  itemName: string;
  onConfirm: (confirmation: string) => Promise<void>;
  onClose: () => void;
}

// Permanent deletion: the user has to type DELETE.
export function ConfirmDeleteModal({ show, title, itemName, onConfirm, onClose }: ConfirmDeleteModalProps) {
  const [typed, setTyped] = useState("");
  const action = useAction();
  useEffect(() => {
    if (show) {
      setTyped("");
      action.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);
  return (
    <Modal
      title={title}
      show={show}
      onDismiss={onClose}
      size="small"
      footer={
        <Flex justifyContent="flex-end" gap={8}>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="emphasized"
            color="critical"
            disabled={typed !== DELETE_CONFIRMATION || action.busy}
            loading={action.busy}
            onClick={() => void action.run(() => onConfirm(typed)).then((ok) => ok && onClose())}
          >
            Delete permanently
          </Button>
        </Flex>
      }
    >
      <Flex flexDirection="column" gap={12}>
        <MessageContainer variant="critical">
          <MessageContainer.Title>Deletion is permanent and cannot be undone.</MessageContainer.Title>
          <MessageContainer.Description>
            The saved snapshot and its title metadata are removed from Grail Resource Store.
          </MessageContainer.Description>
        </MessageContainer>
        <Paragraph>
          You are deleting <Strong>{itemName}</Strong>.
        </Paragraph>
        <FormField>
          <Label>Type {DELETE_CONFIRMATION} to confirm</Label>
          <TextInput value={typed} onChange={(value) => setTyped(value)} autoComplete="off" />
        </FormField>
        {action.error && (
          <MessageContainer variant="critical">
            <MessageContainer.Description>{action.error}</MessageContainer.Description>
          </MessageContainer>
        )}
      </Flex>
    </Modal>
  );
}

export interface RenameModalProps {
  show: boolean;
  currentTitle: string;
  description?: string;
  onSave: (title: string) => Promise<void>;
  onClose: () => void;
}

export function RenameModal({ show, currentTitle, description, onSave, onClose }: RenameModalProps) {
  const [title, setTitle] = useState(currentTitle);
  const action = useAction();
  useEffect(() => {
    if (show) {
      setTitle(currentTitle);
      action.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, currentTitle]);
  const trimmed = title.trim();
  return (
    <Modal
      title="Rename"
      show={show}
      onDismiss={onClose}
      size="small"
      footer={
        <Flex justifyContent="flex-end" gap={8}>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="emphasized"
            color="primary"
            disabled={trimmed.length === 0 || trimmed.length > 200 || trimmed === currentTitle || action.busy}
            loading={action.busy}
            onClick={() => void action.run(() => onSave(trimmed)).then((ok) => ok && onClose())}
          >
            Save title
          </Button>
        </Flex>
      }
    >
      <Flex flexDirection="column" gap={12}>
        {description && <Paragraph>{description}</Paragraph>}
        <FormField required>
          <Label>Title</Label>
          <TextInput value={title} onChange={(value) => setTitle(value)} maxLength={200} />
        </FormField>
        {action.error && (
          <MessageContainer variant="critical">
            <MessageContainer.Description>{action.error}</MessageContainer.Description>
          </MessageContainer>
        )}
      </Flex>
    </Modal>
  );
}

export interface ConfirmModalProps {
  show: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  critical?: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

export function ConfirmModal({ show, title, message, confirmLabel, critical, onConfirm, onClose }: ConfirmModalProps) {
  const action = useAction();
  useEffect(() => {
    if (show) action.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);
  return (
    <Modal
      title={title}
      show={show}
      onDismiss={onClose}
      size="small"
      footer={
        <Flex justifyContent="flex-end" gap={8}>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="emphasized"
            color={critical ? "critical" : "primary"}
            loading={action.busy}
            disabled={action.busy}
            onClick={() => void action.run(onConfirm).then((ok) => ok && onClose())}
          >
            {confirmLabel}
          </Button>
        </Flex>
      }
    >
      <Flex flexDirection="column" gap={12}>
        {typeof message === "string" ? <Paragraph>{message}</Paragraph> : message}
        {action.error && (
          <MessageContainer variant="critical">
            <MessageContainer.Description>{action.error}</MessageContainer.Description>
          </MessageContainer>
        )}
      </Flex>
    </Modal>
  );
}
