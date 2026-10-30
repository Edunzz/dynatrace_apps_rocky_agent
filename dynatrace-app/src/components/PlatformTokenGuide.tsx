import { CodeSnippet } from "@dynatrace/strato-components/content";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Tab, Tabs } from "@dynatrace/strato-components/navigation";
import { Code, ExternalLink, Heading, List, Paragraph, Strong } from "@dynatrace/strato-components/typography";
import React from "react";
import {
  APP_DEPLOY_SCOPES,
  DTCTL_SCOPES_DOCS,
  PLATFORM_TOKEN_DOCS,
  PLATFORM_TOKEN_PREFIX,
  PLATFORM_TOKEN_URL,
  RCA_REQUIRED_SCOPES,
  TOKEN_PROFILES,
} from "../app/platformToken";

function ScopeList({ scopes, label }: { scopes: readonly string[]; label: string }) {
  return (
    <CodeSnippet language="bash" maxHeight={260} aria-label={label}>
      {scopes.join("\n")}
      <CodeSnippet.ActionsMenu>
        <CodeSnippet.Copy />
      </CodeSnippet.ActionsMenu>
    </CodeSnippet>
  );
}

// How to create the runtime's DT_PLATFORM_TOKEN and which scopes it needs.
export function PlatformTokenGuide() {
  return (
    <Flex flexDirection="column" gap={12}>
      <Paragraph>
        The runtime authenticates <Code>dtctl</Code> with a Dynatrace <Strong>platform token</Strong> (it starts with{" "}
        <Code>{PLATFORM_TOKEN_PREFIX}</Code>), passed as <Code>DT_PLATFORM_TOKEN</Code>. It never leaves the runtime container.
        Effective access is the intersection of the token's scopes and the permissions of the user it belongs to, so create it
        for a <Strong>dedicated service user</Strong>.
      </Paragraph>
      <List ordered>
        <span>
          Open <ExternalLink href={PLATFORM_TOKEN_URL}>My platform tokens</ExternalLink> in Account Management and select{" "}
          <Strong>Platform token</Strong>.
        </span>
        <span>Enter a name, an expiration date and the environment, and generate it for your service user.</span>
        <span>Select the scopes of one profile below, select Generate, and copy the token (it is shown only once).</span>
        <span>
          Store it in your secret manager as <Code>DT_PLATFORM_TOKEN</Code> and set <Code>DTCTL_SAFETY_LEVEL</Code> to match the
          profile.
        </span>
      </List>
      <Tabs defaultIndex={0}>
        {TOKEN_PROFILES.map((profile) => (
          <Tab key={profile.id} title={profile.title}>
            <Flex flexDirection="column" gap={8} padding={8}>
              <Paragraph>
                {profile.description} <Code>DTCTL_SAFETY_LEVEL={profile.safetyLevel}</Code> · {profile.scopes.length} scopes
              </Paragraph>
              <ScopeList scopes={profile.scopes} label={`${profile.title} platform token scopes`} />
            </Flex>
          </Tab>
        ))}
        <Tab title="RCA minimum">
          <Flex flexDirection="column" gap={8} padding={8}>
            <Paragraph>The smallest set the bundled RCA skill accepts (its prerequisite check fails without these).</Paragraph>
            <ScopeList scopes={RCA_REQUIRED_SCOPES} label="RCA minimum platform token scopes" />
          </Flex>
        </Tab>
        <Tab title="App deployment">
          <Flex flexDirection="column" gap={8} padding={8}>
            <Paragraph>
              A <Strong>separate</Strong> token used only to deploy this app (<Code>DT_APP_PLATFORM_TOKEN</Code> for{" "}
              <Code>dt-app deploy</Code> or the Codespace). Its user also needs permission to install apps.
            </Paragraph>
            <ScopeList scopes={APP_DEPLOY_SCOPES} label="App deployment platform token scopes" />
          </Flex>
        </Tab>
      </Tabs>
      <Heading level={6}>References</Heading>
      <Paragraph>
        <ExternalLink href={PLATFORM_TOKEN_DOCS}>Platform tokens (Dynatrace documentation)</ExternalLink> ·{" "}
        <ExternalLink href={DTCTL_SCOPES_DOCS}>dtctl token scopes per safety level</ExternalLink>
      </Paragraph>
    </Flex>
  );
}
