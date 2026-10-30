import { ProgressCircle } from "@dynatrace/strato-components/content";
import { Menu } from "@dynatrace/strato-components/navigation";
import { ArrowUpIcon, CheckmarkSmallIcon, ChevronDownSmallIcon } from "@dynatrace/strato-icons";
import React from "react";
import type { RuntimeStatus } from "../models/runtime";
import { offeredOptions, type PromptOptions } from "../utils/promptOptions";

interface Choice {
  label: string;
  hint?: string;
}

const MODELS: Record<string, Choice> = {
  fable: { label: "Fable", hint: "Hardest tasks. On some plans it bills usage credits without asking" },
  opus: { label: "Opus", hint: "Complex reasoning" },
  sonnet: { label: "Sonnet", hint: "Everyday work" },
  haiku: { label: "Haiku", hint: "Fast, simple tasks" },
};

const EFFORTS: Record<string, Choice> = {
  low: { label: "Low" },
  medium: { label: "Medium" },
  high: { label: "High" },
  xhigh: { label: "Extra high" },
  max: { label: "Max", hint: "Deepest and slowest" },
};

interface PickerProps {
  title: string;
  defaultLabel: string;
  value?: string;
  ids: string[];
  catalog: Record<string, Choice>;
  onChange: (value: string | undefined) => void;
}

function Picker({ title, defaultLabel, value, ids, catalog, onChange }: PickerProps) {
  const current = value ? (catalog[value]?.label ?? value) : defaultLabel;
  const item = (id: string | undefined, choice: Choice) => (
    <Menu.Item key={id ?? "default"} textValue={choice.label} onSelect={() => onChange(id)}>
      <span className="rk-pick__item">
        {choice.label}
        {choice.hint ? <span className="rk-pick__hint">{choice.hint}</span> : null}
      </span>
      {id === value ? (
        <Menu.Suffix>
          <CheckmarkSmallIcon aria-label="Selected" />
        </Menu.Suffix>
      ) : null}
    </Menu.Item>
  );
  return (
    <Menu>
      <Menu.Trigger>
        <button type="button" className="rk-pick" aria-label={`${title}: ${current}`}>
          {current}
          <ChevronDownSmallIcon aria-hidden="true" />
        </button>
      </Menu.Trigger>
      <Menu.Content>
        <Menu.Label>{title}</Menu.Label>
        {item(undefined, { label: "Default", hint: "What the runtime is set to use" })}
        {ids.map((id) => item(id, catalog[id] ?? { label: id }))}
      </Menu.Content>
    </Menu>
  );
}

export interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  sending?: boolean;
  disabled?: boolean;
  placeholder?: string;
  agent?: RuntimeStatus["agent"];
  options: PromptOptions;
  onOptionsChange: (options: PromptOptions) => void;
}

// One box: the message on top; the model, the thinking level and the send button
// below. The pickers appear only when the runtime reports what it accepts.
export function Composer({ value, onChange, onSend, sending = false, disabled = false, placeholder, agent, options, onOptionsChange }: ComposerProps) {
  const chosen = offeredOptions(options, agent);
  const canSend = Boolean(value.trim()) && !sending && !disabled;
  return (
    <form
      aria-label="Send a prompt"
      className="rk-composer-box"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) onSend();
      }}
    >
      <textarea
        aria-label="Message"
        className="rk-composer-box__input"
        value={value}
        rows={2}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            if (canSend) onSend();
          }
        }}
      />
      <div className="rk-composer-box__bar">
        {agent?.models?.length ? (
          <Picker
            title="Model"
            defaultLabel="Default model"
            value={chosen.model}
            ids={agent.models}
            catalog={MODELS}
            onChange={(model) => onOptionsChange({ ...chosen, model })}
          />
        ) : null}
        {agent?.efforts?.length ? (
          <Picker
            title="Thinking level"
            defaultLabel="Default thinking"
            value={chosen.effort}
            ids={agent.efforts}
            catalog={EFFORTS}
            onChange={(effort) => onOptionsChange({ ...chosen, effort })}
          />
        ) : null}
        <span className="rk-spacer" />
        <p className="rk-small rk-composer-box__hint">
          <span className="rk-kbd">Ctrl</span> + <span className="rk-kbd">Enter</span>
        </p>
        <button type="submit" className="rk-send" aria-label="Send" disabled={!canSend}>
          {sending ? <ProgressCircle size="small" aria-label="Sending" /> : <ArrowUpIcon aria-hidden="true" />}
        </button>
      </div>
    </form>
  );
}
