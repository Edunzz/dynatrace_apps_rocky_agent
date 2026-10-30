import { Button } from "@dynatrace/strato-components/buttons";
import { FormField, Label, PasswordInput } from "@dynatrace/strato-components/forms";
import { Flex, Surface } from "@dynatrace/strato-components/layouts";
import { Heading } from "@dynatrace/strato-components/typography";
import { FieldHint } from "./FieldHint";
import React, { useState } from "react";
import { useConnection } from "../app/ConnectionContext";

// For "Ask every session" connections: the password stays in memory only.
export function PasswordPrompt() {
  const { active, setMemoryPassword } = useConnection();
  const [value, setValue] = useState("");
  if (!active) return null;
  return (
    <Surface padding={16}>
      <form
        aria-label="Runtime password"
        onSubmit={(e) => {
          e.preventDefault();
          if (value) setMemoryPassword(value);
          setValue("");
        }}
      >
        <Flex flexDirection="column" gap={8}>
          <Heading level={5}>Password required for {active.displayName}</Heading>
          <FormField required>
            <Label>Runtime password</Label>
            <PasswordInput value={value} onChange={(v) => setValue(v)} autoComplete="current-password" />
            <FieldHint>Kept in this browser tab's memory only; never stored.</FieldHint>
          </FormField>
          <Button type="submit" variant="emphasized" color="primary" disabled={!value}>
            Unlock
          </Button>
        </Flex>
      </form>
    </Surface>
  );
}
