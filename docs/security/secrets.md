# Secret handling

## Policy

1. Secrets are injected **at deploy time** by the platform's secret store.
2. Never put secrets in images, build arguments, Git, Terraform state, shell
   history, app settings in plaintext or Grail Resource Store.
3. Each secret has one purpose and one owner; rotate on a schedule and after
   any suspected exposure.
4. Logs and status endpoints never contain secret values. Variables whose names
   contain `TOKEN`, `PASSWORD`, `SECRET`, `API_KEY`, `CREDENTIAL` or `AUTH` are
   always shown as `[REDACTED]`.

| Secret | Consumer | Notes |
|---|---|---|
| `DT_PLATFORM_TOKEN` | dtctl inside the runtime | Dedicated service user; never reaches the app or browser |
| `OPENCODE_SERVER_PASSWORD` | Rocky gateway | 16+ characters; the app stores it as an owner-only secret or reads it from the Credential Vault |
| Provider keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENCODE_API_KEY`) | OpenCode | Prefer cloud roles (Bedrock task role) when possible |

## Docker and Docker Compose

```bash
install -m 600 /dev/null rocky.env    # create the file with restrictive permissions first
${EDITOR:-vi} rocky.env
docker run --env-file rocky.env ...
```

With Compose, keep `.env` out of Git (already in `.gitignore`). For Swarm,
use `docker secret create` and read the files in a wrapper entrypoint.

## AWS Secrets Manager (ECS)

```bash
aws secretsmanager create-secret --name rocky-agent/dt-platform-token --secret-string file://token.txt
aws secretsmanager create-secret --name rocky-agent/server-password   --secret-string file://password.txt
shred -u token.txt password.txt
```

The task definition references the ARNs under `secrets`; only the execution
role may read exactly those ARNs (see `deploy/aws-ecs`). Rotate by writing a
new secret version and forcing a new deployment.

## Azure Key Vault (Container Apps)

```bash
az keyvault secret set --vault-name <vault> --name dt-platform-token --file token.txt
az keyvault secret set --vault-name <vault> --name server-password --file password.txt
az keyvault secret set --vault-name <vault> --name model-api-key --file model-key.txt
```

The Container App reads versionless Key Vault references with its
user-assigned identity (**Key Vault Secrets User**). Rotate by adding a new
secret version and restarting the revision.

## Kubernetes Secrets

```bash
kubectl -n rocky-agent create secret generic rocky-agent-secrets \
  --from-file=DT_PLATFORM_TOKEN=./token.txt \
  --from-file=OPENCODE_SERVER_PASSWORD=./password.txt \
  --from-file=ANTHROPIC_API_KEY=./anthropic.txt
```

Prefer External Secrets Operator, Sealed Secrets or the Secrets Store CSI
driver; enable encryption at rest for etcd and restrict `get secrets` RBAC.

## Dynatrace App side

* **Owner-only secret (default):** the password is sent once to the app
  settings API and stored as a `secret` property; it is masked everywhere
  except inside this app's functions.
* **Credential Vault:** store a username/password credential that allows app
  access and enter its `CREDENTIALS_VAULT-…` ID.
* **Memory only:** the password is typed for each browser session and never stored.

## Generating strong values

```bash
openssl rand -base64 32 | tr -d '\n' > password.txt   # runtime password
```
