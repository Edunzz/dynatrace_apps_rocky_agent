import { AppRoot } from "@dynatrace/strato-components/core";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { ConfirmDeleteModal } from "../../src/components/modals";
import { ConnectionTestResults } from "../../src/components/ConnectionTestResults";
import { MessageTimeline } from "../../src/components/MessageTimeline";
import { PermissionCard } from "../../src/components/PermissionCard";
import { PromptCards, SUGGESTED_PROMPTS } from "../../src/components/PromptCards";
import { StatusLight } from "../../src/components/StatusLight";
import { MESSAGES, PERMISSION } from "../fixtures";

function renderUi(ui: React.ReactElement) {
  return render(<AppRoot>{ui}</AppRoot>);
}

describe("StatusLight", () => {
  it("exposes label and state to assistive technology, not only color", () => {
    renderUi(<StatusLight label="Dynatrace" value="Authentication failed" tone="critical" detail="Check the token" />);
    const status = screen.getByRole("status", { name: "Dynatrace: Authentication failed. Check the token" });
    expect(status.textContent).toContain("Authentication failed");
  });
});

describe("PromptCards", () => {
  it("offers the four suggested prompts as keyboard-accessible buttons", () => {
    const onPick = jest.fn();
    renderUi(<PromptCards selected={null} onPick={onPick} />);
    const group = screen.getByRole("group", { name: "Suggested prompts" });
    const buttons = group.querySelectorAll("button");
    expect(buttons).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: /Root cause analysis/ }));
    expect(onPick).toHaveBeenCalledWith(SUGGESTED_PROMPTS[0]);
    expect(SUGGESTED_PROMPTS[0].text).toBe(
      "Perform an RCA for a problem or incident. Ask for the affected service, impact, and time range before analysis.",
    );
  });

  it("marks the selected card and uses a responsive grid", () => {
    renderUi(<PromptCards selected="logs" onPick={() => undefined} />);
    expect(screen.getByRole("button", { name: /Log value and sensitive data/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("group", { name: "Suggested prompts" }).style.gridTemplateColumns).toContain("auto-fit");
  });
});

describe("ConnectionTestResults", () => {
  it("lists every validation step with its outcome", () => {
    renderUi(
      <ConnectionTestResults
        result={{
          ok: false,
          agentVersion: null,
          runtimeVersion: null,
          gateway: false,
          capabilities: [],
          steps: [
            { id: "url", label: "URL syntax and HTTPS", status: "pass", detail: "ok" },
            { id: "authentication", label: "Authentication", status: "fail", detail: "The runtime rejected the username or password." },
          ],
        }}
      />,
    );
    expect(screen.getByText("Connection test failed")).toBeTruthy();
    expect(screen.getByText(/rejected the username or password/)).toBeTruthy();
  });
});

describe("MessageTimeline", () => {
  it("shows the conversation and tool activity but never hidden reasoning", () => {
    renderUi(<MessageTimeline messages={MESSAGES} busy={false} />);
    const list = screen.getByRole("list", { name: "Conversation" });
    expect(list.textContent).toContain("Please use bash");
    expect(list.textContent).toContain("bash");
    expect(list.textContent).not.toContain("HIDDEN-REASONING");
  });
});

describe("PermissionCard", () => {
  it("approves a single operation", async () => {
    const onReply = jest.fn().mockResolvedValue(undefined);
    renderUi(<PermissionCard request={PERMISSION} onReply={onReply} />);
    expect(screen.getByText(/covers this single operation only/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Approve once" }));
    });
    expect(onReply).toHaveBeenCalledWith(PERMISSION.id, "once");
  });
});

describe("ConfirmDeleteModal", () => {
  it("requires typing DELETE and warns that deletion is permanent", async () => {
    const onConfirm = jest.fn().mockResolvedValue(undefined);
    renderUi(<ConfirmDeleteModal show title="Delete saved session" itemName="Checkout RCA" onConfirm={onConfirm} onClose={() => undefined} />);
    expect(screen.getByText("Deletion is permanent and cannot be undone.")).toBeTruthy();
    const button = screen.getByRole("button", { name: "Delete permanently" });
    expect(button.hasAttribute("disabled") || button.getAttribute("aria-disabled") === "true").toBe(true);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "DELETE" } });
    const enabled = screen.getByRole("button", { name: "Delete permanently" });
    expect(enabled.hasAttribute("disabled")).toBe(false);
    await act(async () => {
      fireEvent.click(enabled);
    });
    expect(onConfirm).toHaveBeenCalledWith("DELETE");
  });

  it("shows why the deletion failed", async () => {
    const onConfirm = jest.fn().mockRejectedValue(new Error("Schema not found"));
    renderUi(<ConfirmDeleteModal show title="Delete saved session" itemName="Checkout RCA" onConfirm={onConfirm} onClose={() => undefined} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "DELETE" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
    });
    expect(screen.getByText("Schema not found")).toBeTruthy();
  });
});

// Strato's MessageContainer renders bare text as an empty box: the text has to be
// inside MessageContainer.Title or MessageContainer.Description.
describe("MessageContainer usage", () => {
  const srcDir = join(__dirname, "../../src");
  const files = (readdirSync(srcDir, { recursive: true }) as string[]).filter((f) => f.endsWith(".tsx"));

  it.each(files)("%s puts its text in a subcomponent", (file) => {
    const source = readFileSync(join(srcDir, file), "utf8");
    const bare = [...source.matchAll(/<MessageContainer(?![.\w])[^>]*>\s*(?!<MessageContainer\.)\S[^\n]*/g)].map((m) => m[0]);
    expect(bare).toEqual([]);
  });
});
