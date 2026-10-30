import { getAppVersion } from "@dynatrace-sdk/app-environment";
import { Modal } from "@dynatrace/strato-components/overlays";
import { ExternalLink } from "@dynatrace/strato-components/typography";
import React from "react";
import { REPO } from "../app/deploymentGuides";

export const AUTHOR = "Jose Eduardo Romero Jimenez";

// The installed version, from the platform. Outside Dynatrace (tests, previews)
// the SDK throws or returns a placeholder, so anything but a version is dropped.
export function appVersion(): string {
  try {
    const version = getAppVersion();
    return /^\d+\.\d+\.\d+/.test(version) ? version : "";
  } catch {
    return "";
  }
}

export function Disclaimer() {
  return (
    <div role="note" className="rk-disclaimer">
      <strong>Disclaimer.</strong> This is a community app. It is not an official Dynatrace product, it is not affiliated with
      Anthropic, and Dynatrace doesn't support it. The only support is the one the author offers through the GitHub repository —{" "}
      <ExternalLink href={`${REPO}/issues`}>open an issue</ExternalLink>. Use it at your own risk.
    </div>
  );
}

export function AboutModal({ show, onClose }: { show: boolean; onClose: () => void }) {
  const version = appVersion();
  return (
    <Modal title="About Rocky Agent" show={show} onDismiss={onClose} size="small">
      <div className="rk-stack">
        <p className="rk-about__lead">
          Run Dynatrace investigations with an AI agent you host yourself, powered by Claude: root cause analyses, log and alert
          reviews, dashboards and workflows. It works read-only by default and asks before it changes anything.
        </p>
        <dl className="rk-about">
          <dt>Version</dt>
          <dd>{version || "Unknown"}</dd>
          <dt>Author</dt>
          <dd>{AUTHOR}</dd>
          <dt>Source code</dt>
          <dd>
            <ExternalLink href={REPO}>github.com/Edunzz/dynatrace_apps_rocky_agent</ExternalLink>
          </dd>
          <dt>Documentation</dt>
          <dd>
            <ExternalLink href={`${REPO}#readme`}>README on GitHub</ExternalLink>
          </dd>
        </dl>
        <Disclaimer />
      </div>
    </Modal>
  );
}

export function AppFooter() {
  const version = appVersion();
  return (
    <footer className="rk-footer">
      Rocky Agent{version ? ` v${version}` : ""} · Built by {AUTHOR} · <ExternalLink href={REPO}>GitHub</ExternalLink> · Community
      app, not supported by Dynatrace
    </footer>
  );
}
