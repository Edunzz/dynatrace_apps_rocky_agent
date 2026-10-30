import { HealthIndicator } from "@dynatrace/strato-components/content";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Strong, Text } from "@dynatrace/strato-components/typography";
import React from "react";
import type { ConnectionTestResult, StepStatus } from "../models/connection";

const STATUS: Record<StepStatus, { indicator: "ideal" | "warning" | "critical" | "neutral"; label: string }> = {
  pass: { indicator: "ideal", label: "Passed" },
  warn: { indicator: "warning", label: "Warning" },
  fail: { indicator: "critical", label: "Failed" },
  skip: { indicator: "neutral", label: "Skipped" },
};

export function ConnectionTestResults({ result }: { result: ConnectionTestResult }) {
  return (
    <section aria-label="Connection test results">
      <Strong>{result.ok ? "Connection test passed" : "Connection test failed"}</Strong>
      <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }}>
        {result.steps.map((step) => (
          <li key={step.id} style={{ marginBottom: 6 }}>
            <Flex gap={8} alignItems="flex-start">
              <HealthIndicator status={STATUS[step.status].indicator} aria-label={`${step.label}: ${STATUS[step.status].label}`} />
              <div>
                <Strong>{step.label}</Strong> <Text>— {STATUS[step.status].label}</Text>
                <Text style={{ display: "block", fontSize: 12, opacity: 0.85 }}>{step.detail}</Text>
              </div>
            </Flex>
          </li>
        ))}
      </ul>
    </section>
  );
}
