import { useCallback, useState } from "react";
import { type PromptOptions, readPromptOptions, savePromptOptions } from "../utils/promptOptions";

// The model and thinking level for prompts, remembered per browser.
export function usePromptOptions() {
  const [options, setOptionsState] = useState<PromptOptions>(readPromptOptions);
  const setOptions = useCallback((value: PromptOptions) => {
    setOptionsState(value);
    savePromptOptions(value);
  }, []);
  return [options, setOptions] as const;
}
