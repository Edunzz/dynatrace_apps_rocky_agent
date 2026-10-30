# Deploy with Docker

## Prerequisites

* Docker 24+ (or Podman) on a host the Dynatrace App Function can reach over HTTPS.
* A reverse proxy with a publicly trusted certificate (Caddy, nginx, Traefik).
* Outbound HTTPS from the host to your Dynatrace environment and model provider.

## Deploy

```bash
install -m 600 /dev/null rocky.env
cat > rocky.env <<'EOF'
DT_PLATFORM_URL=https://abc12345.apps.dynatrace.com
DT_PLATFORM_TOKEN=<platform token>
OPENCODE_SERVER_USERNAME=opencode
OPENCODE_SERVER_PASSWORD=<16+ characters>
OPENCODE_PROVIDER=anthropic
OPENCODE_MODEL=anthropic/claude-sonnet-4-5
ANTHROPIC_API_KEY=<provider key>
NODE_ENV=production
EOF
# Edit the placeholders with an editor; do not type secrets on the command line.

docker volume create rocky-workspace
docker run -d --name rocky-agent --restart unless-stopped \
  --env-file rocky.env \
  -p 127.0.0.1:4096:4096 \
  -v rocky-workspace:/workspace \
  --read-only --tmpfs /tmp:size=512m --tmpfs /home/rocky:size=1g,uid=10001,gid=10001 \
  --cap-drop ALL --security-opt no-new-privileges:true \
  ghcr.io/edunzz/dynatrace_apps_rocky_agent:0.1.0
```

Or with Compose from the repository root: `docker compose up -d` (reads `.env`).

## Reverse proxy (Caddy example)

```text
rocky-agent.example.com {
  reverse_proxy 127.0.0.1:4096
}
```

Caddy obtains a public certificate automatically. Restrict access with your
firewall or proxy rules where possible.

## Health checks

```bash
docker inspect --format '{{.State.Health.Status}}' rocky-agent    # healthy
curl -fsS https://rocky-agent.example.com/rocky/v1/livez            # {"status":"ok"}
docker logs rocky-agent | grep -E '\[FAIL\]|Dynatrace connection'
```

## Validation checklist

- [ ] Container is `healthy`
- [ ] `/rocky/v1/livez` answers through the HTTPS URL
- [ ] Runtime host is allowlisted for App Functions
- [ ] The app's connection test passes

## Cleanup

```bash
docker rm -f rocky-agent
docker volume rm rocky-workspace     # removes the workspace and all ephemeral sessions
shred -u rocky.env
```

## Cost and security notes

* 1 vCPU and 2 GiB RAM are enough to start; large repositories need 2 vCPU and 4–8 GiB.
* Publish the port on `127.0.0.1` only; never expose 4096 directly.
* Building locally: `docker build -t rocky-agent:local agent-runtime`
  (`--build-arg INSTALL_DRAWIO_DESKTOP=false` for a slimmer image without PNG export).
