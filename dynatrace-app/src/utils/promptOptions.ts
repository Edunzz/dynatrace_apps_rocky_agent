// The model and thinking level chosen for prompts. Empty means the runtime's default.
export interface PromptOptions {
  model?: string;
  effort?: string;
}

interface OfferedChoices {
  models?: string[];
  efforts?: string[];
}

const STORAGE_KEY = "rocky-agent.promptOptions";

// A per-browser convenience: storage may be unavailable or hold anything.
export function readPromptOptions(): PromptOptions {
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
    const { model, effort } = (saved && typeof saved === "object" ? saved : {}) as Record<string, unknown>;
    return { model: typeof model === "string" ? model : undefined, effort: typeof effort === "string" ? effort : undefined };
  } catch {
    return {};
  }
}

export function savePromptOptions(options: PromptOptions) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
  } catch {
    // Ignore: the choice just is not remembered.
  }
}

// Keeps only what this runtime offers. Runtimes before 0.2.3 offer nothing and
// would silently ignore the options, so nothing is sent to them.
export function offeredOptions(options: PromptOptions, offered?: OfferedChoices): PromptOptions {
  return {
    model: options.model && offered?.models?.includes(options.model) ? options.model : undefined,
    effort: options.effort && offered?.efforts?.includes(options.effort) ? options.effort : undefined,
  };
}
