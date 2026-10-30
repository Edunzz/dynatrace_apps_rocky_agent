import { Button } from "@dynatrace/strato-components/buttons";
import { MessageContainer } from "@dynatrace/strato-components/content";
import { FormField, Label, NumberInputV2, PasswordInput, Radio, RadioGroup, Switch, TextInput } from "@dynatrace/strato-components/forms";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading } from "@dynatrace/strato-components/typography";
import { FieldHint } from "./FieldHint";
import React, { useEffect, useMemo, useState } from "react";
import type { AuthMode, ConnectionRef, ConnectionTestResult, StoredConnection } from "../models/connection";
import { type ConnectionDraft, connectionsApi } from "../services/connections";
import { errorMessage } from "../services/functions";
import { testConnection } from "../services/runtime";
import { validateRuntimeUrl } from "../utils/url";
import { ConnectionTestResults } from "./ConnectionTestResults";

export interface ConnectionFormProps {
  existing?: StoredConnection | null;
  onSaved: (objectId: string, memoryPassword: string | null) => Promise<void> | void;
  onCancel?: () => void;
}

const VAULT_ID = /^CREDENTIALS_VAULT-[A-Z0-9]+$/;

export function ConnectionForm({ existing, onSaved, onCancel }: ConnectionFormProps) {
  const [displayName, setDisplayName] = useState(existing?.displayName ?? "");
  const [runtimeUrl, setRuntimeUrl] = useState(existing?.runtimeUrl ?? "");
  const [username, setUsername] = useState(existing?.username ?? "rocky");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<AuthMode>(existing?.authMode ?? "settings-secret");
  const [vaultId, setVaultId] = useState(existing?.credentialVaultId ?? "");
  const [customCa, setCustomCa] = useState(existing?.customCaReference ?? "");
  const [timeoutSeconds, setTimeoutSeconds] = useState<number>(existing?.timeoutSeconds ?? 30);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setTestResult(null), [runtimeUrl, username, password, authMode, vaultId]);

  const url = useMemo(() => validateRuntimeUrl(runtimeUrl, { allowLocalHttp: true }), [runtimeUrl]);
  const isLocalHttp = url.ok && url.normalized?.startsWith("http://");
  // Changing where the password goes requires typing it again.
  const targetChanged = Boolean(existing) && (existing?.runtimeUrl !== runtimeUrl.trim() || existing?.username !== username.trim());
  const passwordRequired = authMode !== "credential-vault" && (!existing || targetChanged || existing.authMode !== authMode);

  const problems: string[] = [];
  if (!displayName.trim()) problems.push("Enter a connection name.");
  if (runtimeUrl && !url.ok) problems.push(...url.errors);
  if (!runtimeUrl) problems.push("Enter the runtime URL.");
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(username)) problems.push("The username may contain letters, digits, '.', '_' and '-'.");
  if (authMode === "credential-vault" && !VAULT_ID.test(vaultId.trim())) problems.push("Enter a Credential Vault ID (CREDENTIALS_VAULT-…).");
  if (passwordRequired && !password) problems.push("Enter the runtime password.");

  const draft = (): ConnectionDraft => ({
    displayName: displayName.trim(),
    runtimeUrl: url.normalized ?? runtimeUrl.trim(),
    username: username.trim(),
    authMode,
    credentialVaultId: authMode === "credential-vault" ? vaultId.trim() : null,
    tlsVerification: true,
    customCaReference: customCa.trim() || null,
    timeoutSeconds,
    password: authMode === "settings-secret" && password ? password : undefined,
    lastSuccessfulConnection: existing?.lastSuccessfulConnection ?? null,
    runtimeVersion: existing?.runtimeVersion ?? null,
    capabilities: existing?.capabilities ?? null,
  });

  const testRef = (): ConnectionRef | null => {
    if (password && url.normalized) {
      return { adHoc: { runtimeUrl: url.normalized, username: username.trim(), password, timeoutSeconds } };
    }
    if (existing && !targetChanged) return { connectionId: existing.objectId };
    return null;
  };

  const runTest = async () => {
    const ref = testRef();
    if (!ref) {
      setError(authMode === "credential-vault" ? "Save the connection first; the password is read from the Credential Vault." : "Enter the password to test.");
      return;
    }
    setBusy("test");
    setError(null);
    try {
      setTestResult(await testConnection(ref));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy("save");
    setError(null);
    try {
      const value = draft();
      if (testResult?.ok) {
        value.lastSuccessfulConnection = new Date().toISOString();
        value.runtimeVersion = testResult.runtimeVersion ?? testResult.agentVersion;
        value.capabilities = testResult.capabilities;
      }
      let objectId: string;
      if (existing) {
        await connectionsApi.update(existing, value);
        objectId = existing.objectId;
      } else {
        objectId = await connectionsApi.create(value);
      }
      setPassword("");
      await onSaved(objectId, authMode === "memory-only" ? password || null : null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <form
      aria-label="Runtime connection"
      onSubmit={(e) => {
        e.preventDefault();
        if (problems.length === 0) void save();
      }}
    >
      <Flex flexDirection="column" gap={12}>
        <Heading level={4}>{existing ? `Edit ${existing.displayName}` : "New runtime connection"}</Heading>

        <FormField required>
          <Label>Connection name</Label>
          <TextInput value={displayName} onChange={(v) => setDisplayName(v)} placeholder="Production runtime" maxLength={100} />
        </FormField>

        <FormField required>
          <Label>Runtime URL</Label>
          <TextInput value={runtimeUrl} onChange={(v) => setRuntimeUrl(v)} placeholder="https://rocky-agent.example.com" type="url" autoComplete="off" />
          <FieldHint>
            One HTTPS URL (a port or path is fine), for example https://rocky-agent.company.internal or https://rocky-agent.example.com:4096.
            http://localhost:4096 works only for local development with dt-app dev.
          </FieldHint>
        </FormField>
        {isLocalHttp && (
          <MessageContainer variant="warning">Plain HTTP is accepted for local development only. Deployed apps cannot reach localhost.</MessageContainer>
        )}

        <FormField required>
          <Label>Username</Label>
          <TextInput value={username} onChange={(v) => setUsername(v)} autoComplete="username" maxLength={64} />
        </FormField>

        <FormField>
          <Label>Password storage</Label>
          <RadioGroup value={authMode} onChange={(v) => setAuthMode(v as AuthMode)} name="authMode">
            <Radio value="settings-secret">Store as an owner-only secret (readable only by this app's backend)</Radio>
            <Radio value="credential-vault">Use a Credential Vault entry</Radio>
            <Radio value="memory-only">Ask every session (kept in memory only)</Radio>
          </RadioGroup>
        </FormField>

        {authMode === "credential-vault" ? (
          <FormField required>
            <Label>Credential Vault ID</Label>
            <TextInput value={vaultId} onChange={(v) => setVaultId(v)} placeholder="CREDENTIALS_VAULT-…" />
            <FieldHint>A username/password credential that is allowed for app access.</FieldHint>
          </FormField>
        ) : (
          <FormField required={passwordRequired}>
            <Label>Password</Label>
            <PasswordInput value={password} onChange={(v) => setPassword(v)} autoComplete="new-password" />
            <FieldHint>
              {existing && !passwordRequired
                ? "Leave empty to keep the stored password."
                : authMode === "memory-only"
                  ? "Used for this browser session only and never stored."
                  : "Never shown again after saving."}
            </FieldHint>
          </FormField>
        )}

        <FormField>
          <Label>TLS verification</Label>
          <Switch value disabled aria-describedby="tls-hint">
            Verify the runtime certificate
          </Switch>
          <FieldHint id="tls-hint">Always enforced: Dynatrace App Functions cannot disable certificate checks.</FieldHint>
        </FormField>

        <FormField>
          <Label>Custom CA reference (optional)</Label>
          <TextInput value={customCa} onChange={(v) => setCustomCa(v)} placeholder="corp-root-ca-2026" maxLength={300} />
          <FieldHint>For documentation only. A runtime with a private CA must be reached through EdgeConnect or a gateway with a public certificate.</FieldHint>
        </FormField>

        <FormField>
          <Label>Connection timeout (seconds)</Label>
          <NumberInputV2 value={timeoutSeconds} onChange={(v) => setTimeoutSeconds(Math.min(100, Math.max(5, v ?? 30)))} min={5} max={100} />
        </FormField>

        {problems.length > 0 && (runtimeUrl || displayName) && (
          <MessageContainer variant="warning">
            <MessageContainer.Description>{problems.join(" ")}</MessageContainer.Description>
          </MessageContainer>
        )}
        {error && <MessageContainer variant="critical">{error}</MessageContainer>}
        {testResult && <ConnectionTestResults result={testResult} />}

        <Flex gap={8} flexWrap="wrap">
          <Button onClick={() => void runTest()} loading={busy === "test"} disabled={busy !== null || !url.ok}>
            Test connection
          </Button>
          <Button type="submit" variant="emphasized" color="primary" loading={busy === "save"} disabled={busy !== null || problems.length > 0}>
            Save connection
          </Button>
          {onCancel && <Button onClick={onCancel}>Cancel</Button>}
        </Flex>
      </Flex>
    </form>
  );
}
