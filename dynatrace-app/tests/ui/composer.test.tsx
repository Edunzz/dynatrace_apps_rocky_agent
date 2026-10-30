import { AppRoot } from "@dynatrace/strato-components/core";
import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import React from "react";
import { Composer, type ComposerProps } from "../../src/components/Composer";
import { useStickToBottom } from "../../src/hooks/useStickToBottom";
import type { RuntimeStatus } from "../../src/models/runtime";
import { offeredOptions, readPromptOptions, savePromptOptions } from "../../src/utils/promptOptions";

const AGENT: RuntimeStatus["agent"] = {
  status: "ready",
  name: "Claude Code",
  version: "2.1.308",
  models: ["fable", "opus", "sonnet", "haiku"],
  efforts: ["low", "medium", "high", "xhigh", "max"],
};

function setup(props: Partial<ComposerProps> = {}) {
  const onSend = jest.fn();
  const onOptionsChange = jest.fn();
  render(
    <AppRoot>
      <Composer value="hello" onChange={() => undefined} onSend={onSend} agent={AGENT} options={{}} onOptionsChange={onOptionsChange} {...props} />
    </AppRoot>,
  );
  return { onSend, onOptionsChange };
}

describe("Composer", () => {
  it("sends with the button and with Ctrl+Enter, but not with plain Enter", () => {
    const { onSend } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Message" }), { key: "Enter", ctrlKey: true });
    expect(onSend).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Message" }), { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(2);
  });

  it("cannot send an empty message", () => {
    const { onSend } = setup({ value: "   " });
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Send" }).disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Message" }), { key: "Enter", ctrlKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("shows the chosen model and thinking level", () => {
    setup({ options: { model: "opus", effort: "xhigh" } });
    expect(screen.getByRole("button", { name: "Model: Opus" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Thinking level: Extra high" })).toBeTruthy();
  });

  it("changes the model and the thinking level from their menus", async () => {
    const { onOptionsChange } = setup({ options: { effort: "high" } });
    const open = (name: string) => fireEvent.keyDown(screen.getByRole("button", { name }), { key: "Enter" });
    open("Model: Default model");
    expect((await screen.findByRole("menuitem", { name: /Fable/ })).textContent).toMatch(/usage credits/);
    fireEvent.click(await screen.findByRole("menuitem", { name: /Opus/ }));
    expect(onOptionsChange).toHaveBeenLastCalledWith({ model: "opus", effort: "high" });
    open("Thinking level: High");
    fireEvent.click(await screen.findByRole("menuitem", { name: /Extra high/ }));
    expect(onOptionsChange).toHaveBeenLastCalledWith({ effort: "xhigh" });
  });

  it("falls back to the defaults and hides nothing else for an unknown choice", () => {
    setup({ options: { model: "retired-model" } });
    expect(screen.getByRole("button", { name: "Model: Default model" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Thinking level: Default thinking" })).toBeTruthy();
  });

  it("hides the pickers when the runtime does not offer them", () => {
    setup({ agent: { status: "ready", name: "Claude Code", version: "2.1.308" } });
    expect(screen.queryByRole("button", { name: /^Model:/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Thinking level:/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
  });
});

describe("prompt options", () => {
  beforeEach(() => window.localStorage.clear());

  it("are remembered and survive bad stored data", () => {
    expect(readPromptOptions()).toEqual({});
    savePromptOptions({ model: "opus", effort: "high" });
    expect(readPromptOptions()).toEqual({ model: "opus", effort: "high" });
    window.localStorage.setItem("rocky-agent.promptOptions", "{not json");
    expect(readPromptOptions()).toEqual({});
    window.localStorage.setItem("rocky-agent.promptOptions", JSON.stringify({ model: 3 }));
    expect(readPromptOptions().model).toBeUndefined();
  });

  it("are sent only when the runtime offers them", () => {
    const chosen = { model: "opus", effort: "max" };
    expect(offeredOptions(chosen, AGENT)).toEqual(chosen);
    expect(offeredOptions(chosen, { models: ["sonnet"], efforts: ["low"] })).toEqual({});
    expect(JSON.parse(JSON.stringify(offeredOptions(chosen, undefined)))).toEqual({});
  });
});

describe("useStickToBottom", () => {
  function scroller(heights: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
    const el = document.createElement("div");
    Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => heights.scrollHeight });
    Object.defineProperty(el, "clientHeight", { configurable: true, get: () => heights.clientHeight });
    Object.defineProperty(el, "scrollTop", {
      configurable: true,
      get: () => heights.scrollTop,
      set: (value: number) => {
        heights.scrollTop = value;
      },
    });
    return el;
  }

  function mount(heights: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
    const hook = renderHook(({ session, content }) => useStickToBottom<HTMLDivElement>(session, content), {
      initialProps: { session: "a", content: "1" },
    });
    (hook.result.current.ref as { current: HTMLDivElement | null }).current = scroller(heights);
    return hook;
  }

  it("follows new messages while the user is at the end", () => {
    const heights = { scrollHeight: 1000, clientHeight: 400, scrollTop: 600 };
    const hook = mount(heights);
    heights.scrollHeight = 1300;
    hook.rerender({ session: "a", content: "2" });
    expect(heights.scrollTop).toBe(1300);
  });

  it("leaves the user alone after they scroll up, until another session opens", () => {
    const heights = { scrollHeight: 1000, clientHeight: 400, scrollTop: 100 };
    const hook = mount(heights);
    hook.result.current.onScroll();
    heights.scrollHeight = 1300;
    hook.rerender({ session: "a", content: "2" });
    expect(heights.scrollTop).toBe(100);
    hook.rerender({ session: "b", content: "1" });
    hook.rerender({ session: "b", content: "2" });
    expect(heights.scrollTop).toBe(1300);
  });
});
