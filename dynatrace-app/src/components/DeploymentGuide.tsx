import { CodeSnippet } from "@dynatrace/strato-components/content";
import { Checkbox } from "@dynatrace/strato-components/forms";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Tab, Tabs } from "@dynatrace/strato-components/navigation";
import { ExternalLink, Heading, List, Paragraph } from "@dynatrace/strato-components/typography";
import React, { useState } from "react";
import { DEPLOYMENT_GUIDES, type DeploymentGuide as Guide, REPO } from "../app/deploymentGuides";

function GuidePanel({ guide }: { guide: Guide }) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  return (
    <Flex flexDirection="column" gap={16} padding={8}>
      <Paragraph>{guide.summary}</Paragraph>
      {guide.sections.map((section) => (
        <section key={section.title} aria-label={section.title}>
          <Heading level={5}>{section.title}</Heading>
          {section.text && <Paragraph>{section.text}</Paragraph>}
          {section.items && (
            <List>
              {section.items.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </List>
          )}
          {section.code && (
            <CodeSnippet language={section.code.language} aria-label={`${section.title} for ${guide.title}`}>
              {section.code.content}
              <CodeSnippet.ActionsMenu>
                <CodeSnippet.Copy />
              </CodeSnippet.ActionsMenu>
            </CodeSnippet>
          )}
        </section>
      ))}
      <section aria-label="Validation checklist">
        <Heading level={5}>Validation checklist</Heading>
        <Flex flexDirection="column" gap={4}>
          {guide.checklist.map((item) => (
            <Checkbox key={item} value={checked[item] ?? false} onChange={(value) => setChecked((c) => ({ ...c, [item]: value }))}>
              {item}
            </Checkbox>
          ))}
        </Flex>
      </section>
      <Paragraph>
        Full guide: <ExternalLink href={`${REPO}/blob/main/${guide.docsPath}`}>{guide.docsPath}</ExternalLink>
      </Paragraph>
    </Flex>
  );
}

export function DeploymentGuide() {
  return (
    <Tabs defaultIndex={0}>
      {DEPLOYMENT_GUIDES.map((guide) => (
        <Tab key={guide.id} title={guide.title}>
          <GuidePanel guide={guide} />
        </Tab>
      ))}
    </Tabs>
  );
}
