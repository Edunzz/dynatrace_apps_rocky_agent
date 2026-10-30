// Production implementation of PlatformDeps for the Dynatrace JavaScript runtime.
// Only imported by the app functions in ../../api.

import { appSettingsObjectsClient } from "@dynatrace-sdk/client-app-settings-v2";
import { credentialVaultClient, type CredentialsDetailsUsernamePasswordResponseElement } from "@dynatrace-sdk/client-classic-environment-v2";
import { queryExecutionClient } from "@dynatrace-sdk/client-query";
import { lookupDataClient } from "@dynatrace-sdk/client-resource-store";
import { PlatformBinary } from "@dynatrace-sdk/http-client";
import type { PlatformDeps } from "./deps";
import { AppFunctionError } from "./envelope";

const QUERY_DEADLINE_MS = 60_000;

async function runQuery(query: string): Promise<Record<string, unknown>[]> {
  const started = Date.now();
  let response = await queryExecutionClient.queryExecute({
    body: { query, requestTimeoutMilliseconds: 30_000, maxResultRecords: 1000 },
  });
  while (response.state === "RUNNING" || response.state === "NOT_STARTED") {
    if (!response.requestToken || Date.now() - started > QUERY_DEADLINE_MS) {
      throw new AppFunctionError("query_timeout", "Grail did not return the saved sessions in time.");
    }
    const poll = await queryExecutionClient.queryPoll({ requestToken: response.requestToken, requestTimeoutMilliseconds: 10_000 });
    response = { ...poll, requestToken: response.requestToken };
  }
  if (response.state !== "SUCCEEDED") {
    throw new AppFunctionError("query_failed", `Grail query ended in state ${response.state}.`);
  }
  const records: Record<string, unknown>[] = [];
  for (const record of response.result?.records ?? []) if (record) records.push(record);
  return records;
}

export function platformDeps(): PlatformDeps {
  return {
    fetch: (input, init) => fetch(input, init),
    async getConnectionObject(objectId) {
      // Runs inside the app function, so secret properties are returned in plain text.
      const object = await appSettingsObjectsClient.getAppSettingsObjectByObjectId({ objectId });
      return { value: object.value ?? {} };
    },
    async getVaultCredentials(id) {
      const details = (await credentialVaultClient.getCredentialsDetails({ id })) as CredentialsDetailsUsernamePasswordResponseElement;
      return { username: details.username, password: details.password };
    },
    async currentUser() {
      const response = await fetch("/platform/metadata/v1/user");
      if (!response.ok) throw new AppFunctionError("identity_unavailable", "Could not identify the current user.");
      const body = (await response.json()) as { userId?: string };
      if (!body.userId) throw new AppFunctionError("identity_unavailable", "Could not identify the current user.");
      return { userId: body.userId };
    },
    async uploadLookup(args) {
      try {
        await lookupDataClient.upload({
          body: {
            // A text/csv Blob is the content type verified against the upload API.
            content: PlatformBinary.from(new Blob([args.content], { type: "text/csv" })),
            request: {
              filePath: args.filePath,
              lookupField: args.lookupField,
              parsePattern: args.parsePattern,
              skippedRecords: args.skippedRecords,
              overwrite: args.overwrite,
              displayName: args.displayName,
              description: args.description,
              autoFlatten: true,
            },
          },
        });
      } catch (error) {
        const status = (error as { response?: { status?: number } })?.response?.status;
        if (status === 409 || /exist/i.test(String((error as Error)?.message))) {
          throw new AppFunctionError("already_exists", "A saved session with this ID already exists and cannot be overwritten.", { status: 409 });
        }
        if (status === 403) {
          throw new AppFunctionError("forbidden", "You are not allowed to write to /lookups/rocky-agent/. Ask an administrator for storage:files:write.", { status });
        }
        throw new AppFunctionError("upload_failed", "Uploading to Grail Resource Store failed.", { status });
      }
    },
    async deleteLookup(filePath) {
      try {
        await lookupDataClient.delete({ body: { filePath } });
      } catch (error) {
        const status = (error as { response?: { status?: number } })?.response?.status;
        if (status === 404) return;
        throw new AppFunctionError("delete_failed", "Deleting from Grail Resource Store failed.", { status });
      }
    },
    query: runQuery,
    log(event) {
      // App function logs are collected by Dynatrace; events never contain secrets.
      console.log(JSON.stringify({ component: "rocky-agent-app", time: new Date().toISOString(), ...event }));
    },
    now: () => new Date(),
  };
}
