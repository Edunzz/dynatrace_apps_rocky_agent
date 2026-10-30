import { Text } from "@dynatrace/strato-components/typography";
import React from "react";

// Helper text below a form control.
export function FieldHint({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <Text id={id} style={{ display: "block", fontSize: 12, opacity: 0.8, marginTop: 4 }}>
      {children}
    </Text>
  );
}
