// Deployment guidance shown on the welcome page. Kept in sync with deploy/ and
// docs/deployment/ in the repository.
//
// The entropy-based secret detector flags variable names and file
// placeholders below; this file contains no secret values.
/* eslint-disable noSecrets/no-secrets */

export const IMAGE = "docker.io/edunzz/rocky-agent:0.2.1";
export const REPO = "https://github.com/Edunzz/dynatrace_apps_rocky_agent";

export type GuideLanguage = "bash" | "yaml" | "json";

export interface GuideSection {
  title: string;
  text?: string;
  items?: string[];
  code?: { language: GuideLanguage; content: string };
}

export interface DeploymentGuide {
  id: string;
  title: string;
  summary: string;
  docsPath: string;
  sections: GuideSection[];
  checklist: string[];
}

const HEALTH = `# Liveness (no credentials, returns only {"status":"ok"}):
curl -fsS https://rocky-agent.example.com/rocky/v1/livez

# Authenticated health without putting the password in shell history:
read -rs ROCKY_PASSWORD && printf 'user = "rocky:%s"\\n' "$ROCKY_PASSWORD" | \\
  curl -fsS -K - https://rocky-agent.example.com/rocky/v1/health`;

const ENV_ITEMS = [
  "DT_PLATFORM_URL: https://<environment-id>.apps.dynatrace.com (required)",
  "DT_PLATFORM_TOKEN: platform token (dt0s16.…) of a dedicated service user; see “Dynatrace platform token” for scopes (required, secret)",
  "ROCKY_SERVER_PASSWORD: at least 16 characters (required, secret)",
  "ROCKY_SERVER_USERNAME: default rocky",
  "ROCKY_MODEL: optional, for example sonnet or opus",
  "Claude credential (secret), one of: CLAUDE_CODE_OAUTH_TOKEN (your Claude subscription, personal use only), ANTHROPIC_API_KEY, or CLAUDE_CODE_USE_BEDROCK=1 with AWS_REGION and a task role",
  "NODE_ENV=production, LOG_LEVEL=info, ROCKY_PORT=4096, WORKSPACE_PATH=/workspace",
];

const TLS = "Terminate TLS at the load balancer, ingress or reverse proxy with a publicly trusted certificate. Dynatrace App Functions always verify certificates and cannot trust a private CA; private runtimes must be reached through Dynatrace EdgeConnect or a gateway with a public certificate.";

export const DEPLOYMENT_GUIDES: DeploymentGuide[] = [
  {
    id: "local",
    title: "Your computer (Docker Compose)",
    summary:
      "Fastest way to try Rocky Agent: the runtime runs on your computer with Docker Compose, and a Cloudflare quick tunnel gives it a public HTTPS address this app can call. This app runs its functions in Dynatrace, so it cannot reach your localhost directly. Without a tunnel, run this app on your computer with dt-app dev and connect to http://localhost:4096.",
    docsPath: "docs/deployment/local.md",
    sections: [
      { title: "Prerequisites", items: ["Docker Desktop or Docker Engine with Compose", "Git", "A Dynatrace SaaS environment and a runtime platform token (see “Dynatrace platform token”, Starter)", "A Claude subscription (Pro, Max, Team or Enterprise) or an Anthropic API key", "Without the tunnel: Node.js 20+ to run dt-app dev"] },
      {
        title: "Deployment commands",
        code: {
          language: "bash",
          content: `git clone ${REPO}.git
cd dynatrace_apps_rocky_agent
cp .env.example .env    # set DT_PLATFORM_URL and DT_PLATFORM_TOKEN; change ROCKY_SERVER_PASSWORD
docker compose --profile tunnel up -d
docker compose run --rm rocky-agent login    # once: open the URL it prints, sign in to Claude, paste the code
docker compose logs tunnel    # copy the https://<random>.trycloudflare.com address

# Without the tunnel: runtime on http://127.0.0.1:4096 and this app on your computer
docker compose up -d
cd dynatrace-app && npm ci
DT_APP_ENVIRONMENT_URL=https://<environment-id>.apps.dynatrace.com npm start`,
        },
      },
      { title: "Environment variables", items: [...ENV_ITEMS.slice(0, 2), "ROCKY_SERVER_PASSWORD: your own, 16+ characters (secret). Empty = the public default gundamjromero2026: it works, but change it", ENV_ITEMS[5], "Claude sign-in: docker compose run --rm rocky-agent login (stored in the rocky-home volume), or CLAUDE_CODE_OAUTH_TOKEN / ANTHROPIC_API_KEY in .env", "NODE_ENV: production by default; a password you set yourself needs 16+ characters"] },
      { title: "Secret configuration", text: "Keep secrets in .env (git-ignored, readable only by you). Never commit it." },
      { title: "Networking requirements", items: ["Port 4096 is published on 127.0.0.1 only; the tunnel connects to the runtime inside Docker", "Allow *.trycloudflare.com once in Settings > General > External requests, then connect to the https://….trycloudflare.com address", "The tunnel address changes on every restart: edit the connection with the new one", "With dt-app dev connect to http://localhost:4096 instead (plain HTTP is accepted for localhost only)", "Outbound HTTPS from Docker to Dynatrace, Anthropic and Cloudflare"] },
      { title: "TLS recommendation", text: "The quick tunnel serves the address with a public Cloudflare certificate. It is meant for testing: for teams use a server or cloud deployment with your own HTTPS address. Not needed with dt-app dev on localhost." },
      { title: "Health-check instructions", code: { language: "bash", content: "docker compose ps                      # rocky-agent should be healthy\ncurl -fsS http://127.0.0.1:4096/rocky/v1/livez\ndocker compose logs tunnel             # current public address" } },
      { title: "Cleanup instructions", code: { language: "bash", content: "docker compose --profile tunnel down -v   # also removes the volumes: workspace, Claude login and sessions\n# Remove *.trycloudflare.com from External requests when you stop testing" } },
      { title: "Cost and security notes", items: ["No cloud cost; the runtime uses your machine (about 2 GiB RAM)", "The tunnel makes the runtime reachable from the Internet at a random address: every request needs the password, and only the routes this app uses are exposed", "Allowing *.trycloudflare.com lets every app in the environment call any quick-tunnel address", "Never publish port 4096 itself beyond localhost"] },
    ],
    checklist: ["docker compose ps shows rocky-agent healthy", "docker compose logs tunnel shows a trycloudflare.com address", "*.trycloudflare.com allowed in External requests", "Test connection passes in this app"],
  },
  {
    id: "codespaces",
    title: "Install the app (Codespaces)",
    summary:
      "Install or update this app in a Dynatrace environment without installing anything on your computer: open the repository in GitHub Codespaces, enter the environment URL and an app deployment token, and run npm run deploy:token. The runtime runs elsewhere: on your computer, a server or a cloud service.",
    docsPath: "docs/deployment/codespaces.md",
    sections: [
      { title: "Prerequisites", items: ["GitHub account with Codespaces", "App deployment platform token with app-engine:apps:install, app-engine:apps:run and app-engine:apps:delete (see “Dynatrace platform token”, App deployment)"] },
      {
        title: "Deployment commands",
        text: "Open https://codespaces.new/Edunzz/dynatrace_apps_rocky_agent, fill in the two recommended secrets and create the codespace. Then run this in its terminal (Enter keeps the current values):",
        code: { language: "bash", content: "npm run deploy:token" },
      },
      { title: "Environment variables", items: ["DT_APP_ENVIRONMENT_URL: https://<environment-id>.apps.dynatrace.com", "DT_APP_PLATFORM_TOKEN: token used only to deploy the app (secret)"] },
      { title: "Secret configuration", text: "Codespaces saves both values as your personal Codespaces secrets (github.com > Settings > Codespaces) and offers them for new codespaces. Other Edunzz Dynatrace apps use the same names. The token is never printed." },
      { title: "Networking requirements", items: ["Outbound HTTPS from the codespace to your Dynatrace environment", "No inbound access: the codespace only deploys the app"] },
      { title: "TLS recommendation", text: "Nothing to configure: dt-app deploy calls your environment over HTTPS." },
      { title: "Health-check instructions", text: "npm run deploy:token ends with the app link (…/ui/apps/my.rocky.agent). Open it: the app loads and offers “New runtime connection”." },
      { title: "Cleanup instructions", text: "Stop or delete the codespace; the app stays installed. To remove the app from your environment:", code: { language: "bash", content: "cd dynatrace-app && npx dt-app uninstall" } },
      { title: "Cost and security notes", items: ["Codespaces compute and storage are billed to your GitHub account (personal accounts include a free monthly quota)", "Use a dedicated token for deployment, never the runtime token", "Delete the codespace when you are done"] },
    ],
    checklist: ["The codespace shows “Rocky Agent app — ready to deploy” with the token set", "npm run deploy:token printed the app link", "The app opens in your Dynatrace environment"],
  },
  {
    id: "docker",
    title: "Docker (server)",
    summary: "A single container on a server or VM behind an HTTPS reverse proxy, reachable by the installed app.",
    docsPath: "docs/deployment/docker.md",
    sections: [
      { title: "Prerequisites", items: ["Docker 24+ (or Podman)", "A host the Dynatrace App Function can reach over HTTPS", "A reverse proxy with a public certificate (Caddy, nginx, Traefik)"] },
      {
        title: "Deployment commands",
        text: "Keep secrets in a file with mode 0600 instead of typing them on the command line.",
        code: {
          language: "bash",
          content: `install -m 600 /dev/null rocky.env
\${EDITOR:-vi} rocky.env      # add the variables listed below

docker volume create rocky-workspace
docker run -d --name rocky-agent --restart unless-stopped \\
  --env-file rocky.env \\
  -p 127.0.0.1:4096:4096 \\
  -v rocky-workspace:/workspace \\
  --read-only --tmpfs /tmp:size=512m --tmpfs /home/rocky:size=1g,uid=10001,gid=10001 \\
  --cap-drop ALL --security-opt no-new-privileges:true \\
  ${IMAGE}`,
        },
      },
      { title: "Environment variables", items: ENV_ITEMS },
      {
        title: "Secret configuration",
        text: "Use an env file readable only by the operator, or Docker secrets with Compose/Swarm. Never pass tokens with -e on the command line and never bake them into images.",
      },
      { title: "Networking requirements", items: ["Publish 4096 on 127.0.0.1 only and expose it through the HTTPS proxy", "Allow the runtime host in Dynatrace: Settings > General > External requests", "Outbound HTTPS from the container to your Dynatrace environment and Anthropic (or your cloud provider)"] },
      { title: "TLS recommendation", text: TLS },
      { title: "Health-check instructions", code: { language: "bash", content: HEALTH } },
      { title: "Cleanup instructions", code: { language: "bash", content: "docker rm -f rocky-agent\ndocker volume rm rocky-workspace   # deletes the workspace and every ephemeral session\nshred -u rocky.env" } },
      { title: "Cost and security notes", items: ["Recommended: 1 vCPU, 2 GiB RAM; large repositories need 2 vCPU and 4–8 GiB", "Never expose port 4096 directly to the Internet", "Rotate ROCKY_SERVER_PASSWORD and the platform token regularly"] },
    ],
    checklist: ["Container is healthy (docker ps shows healthy)", "/rocky/v1/livez answers through the HTTPS URL", "Runtime host allowlisted for App Functions", "Test connection passes in this app"],
  },
  {
    id: "ecs",
    title: "Amazon ECS",
    summary: "AWS Fargate in private subnets behind an internal or internet-facing Application Load Balancer with an ACM certificate.",
    docsPath: "docs/deployment/aws-ecs.md",
    sections: [
      { title: "Prerequisites", items: ["AWS account with VPC, private subnets and an ACM certificate", "Terraform 1.6+ or AWS CloudFormation", "Secrets created in AWS Secrets Manager"] },
      {
        title: "Deployment commands",
        code: {
          language: "bash",
          content: `cd deploy/aws-ecs/terraform
cp terraform.tfvars.example terraform.tfvars   # set VPC, subnets, certificate, secret ARNs
terraform init && terraform plan -out rocky.tfplan
terraform apply rocky.tfplan

# Or CloudFormation:
aws cloudformation deploy --stack-name rocky-agent \\
  --template-file deploy/aws-ecs/cloudformation/rocky-agent.yaml \\
  --capabilities CAPABILITY_NAMED_IAM --parameter-overrides file://params.json`,
        },
      },
      { title: "Environment variables", items: ENV_ITEMS },
      {
        title: "Secret configuration",
        code: {
          language: "bash",
          content: `aws secretsmanager create-secret --name rocky-agent/dt-platform-token --secret-string file://token.txt
aws secretsmanager create-secret --name rocky-agent/server-password --secret-string file://password.txt
# The task definition references the ARNs in "secrets"; the execution role may read only these ARNs.`,
        },
      },
      { title: "Networking requirements", items: ["Tasks in private subnets; NAT or VPC endpoints for outbound HTTPS", "ALB HTTPS listener (443) forwarding to port 4096", "Health check path /rocky/v1/livez (no credentials needed)", "Internal ALB + EdgeConnect for private runtimes; restrict an internet-facing ALB with security groups or AWS WAF"] },
      { title: "TLS recommendation", text: TLS },
      { title: "Health-check instructions", code: { language: "bash", content: HEALTH } },
      { title: "Cleanup instructions", code: { language: "bash", content: "terraform destroy        # or: aws cloudformation delete-stack --stack-name rocky-agent\n# Secrets Manager secrets are retained; delete them explicitly if no longer needed." } },
      { title: "Cost and security notes", items: ["Start with 1 vCPU, 2 GiB RAM and 20 GiB ephemeral storage", "Use 2 vCPU and 4–8 GiB for large repositories", "Keep desired count at 1: sessions are local to each task", "Use a task role for Amazon Bedrock instead of static keys"] },
    ],
    checklist: ["Target group reports healthy", "HTTPS URL resolves from Dynatrace", "Secrets resolved by the task (no plaintext in the task definition)", "Test connection passes in this app"],
  },
  {
    id: "aca",
    title: "Azure Container Apps",
    summary: "A Container App with HTTPS ingress, managed identity and Key Vault references.",
    docsPath: "docs/deployment/azure-container-apps.md",
    sections: [
      { title: "Prerequisites", items: ["Azure subscription and resource group", "Azure CLI 2.60+ with Bicep, or Terraform 1.6+", "Key Vault with the runtime secrets"] },
      {
        title: "Deployment commands",
        code: {
          language: "bash",
          content: `az deployment group create -g rg-rocky-agent \\
  -f deploy/azure-container-apps/bicep/main.bicep \\
  -p @deploy/azure-container-apps/bicep/main.parameters.json

# Or Terraform:
cd deploy/azure-container-apps/terraform && terraform init && terraform apply`,
        },
      },
      { title: "Environment variables", items: ENV_ITEMS },
      {
        title: "Secret configuration",
        code: {
          language: "bash",
          content: `az keyvault secret set --vault-name <vault> --name dt-platform-token --file token.txt
az keyvault secret set --vault-name <vault> --name server-password --file password.txt
# The Container App reads them through Key Vault references with its managed identity.`,
        },
      },
      { title: "Networking requirements", items: ["External HTTPS ingress, or internal ingress in a VNet with EdgeConnect", "Target port 4096; allow insecure connections disabled", "IP restrictions on ingress where possible"] },
      { title: "TLS recommendation", text: TLS },
      { title: "Health-check instructions", code: { language: "bash", content: HEALTH } },
      { title: "Cleanup instructions", code: { language: "bash", content: "az group delete -n rg-rocky-agent   # deletes the app, environment and logs workspace" } },
      { title: "Cost and security notes", items: ["Start with 1 vCPU / 2 GiB; use 2 vCPU / 4 GiB for heavy workloads", "minReplicas 1, maxReplicas 1: sessions are local to each replica", "Log Analytics retention drives cost"] },
    ],
    checklist: ["Revision is running and healthy", "Ingress FQDN answers /rocky/v1/livez", "Key Vault references resolve", "Test connection passes in this app"],
  },
  {
    id: "kubernetes",
    title: "Kubernetes",
    summary: "Kustomize manifests with a hardened pod, TLS ingress and a NetworkPolicy.",
    docsPath: "docs/deployment/kubernetes.md",
    sections: [
      { title: "Prerequisites", items: ["Kubernetes 1.28+ with an ingress controller and cert-manager (or another TLS source)", "kubectl 1.28+", "A secret store (External Secrets, Sealed Secrets or CSI driver) for production"] },
      {
        title: "Deployment commands",
        code: {
          language: "bash",
          content: `kubectl create namespace rocky-agent
kubectl -n rocky-agent create secret generic rocky-agent-secrets \\
  --from-file=DT_PLATFORM_TOKEN=./token.txt \\
  --from-file=ROCKY_SERVER_PASSWORD=./password.txt \\
  --from-file=ANTHROPIC_API_KEY=./anthropic.txt
kubectl apply -k deploy/kubernetes/examples/production`,
        },
      },
      { title: "Environment variables", items: ENV_ITEMS },
      { title: "Secret configuration", text: "The Deployment reads secrets with secretKeyRef. Prefer External Secrets Operator or the Secrets Store CSI driver over hand-made Secrets, and enable encryption at rest for etcd." },
      { title: "Networking requirements", items: ["Ingress with TLS for the runtime host", "NetworkPolicy allows ingress only from the ingress controller and egress only to DNS and HTTPS", "Readiness and liveness probes use /rocky/v1/livez"] },
      { title: "TLS recommendation", text: TLS },
      { title: "Health-check instructions", code: { language: "bash", content: `kubectl -n rocky-agent get pods\n${HEALTH}` } },
      { title: "Cleanup instructions", code: { language: "bash", content: "kubectl delete -k deploy/kubernetes/examples/production\nkubectl delete namespace rocky-agent" } },
      { title: "Cost and security notes", items: ["requests 1 CPU / 2Gi, limits 2 CPU / 4Gi", "runAsNonRoot, readOnlyRootFilesystem, no privilege escalation, all capabilities dropped", "replicas: 1 (sessions are local to each pod); the HPA example is for stateless gateways only"] },
    ],
    checklist: ["Pod Ready and not restarting", "Ingress certificate issued", "NetworkPolicy applied", "Test connection passes in this app"],
  },
  {
    id: "existing",
    title: "Existing runtime",
    summary: "Connect to a Rocky runtime that is already running.",
    docsPath: "docs/deployment/existing-runtime.md",
    sections: [
      { title: "Prerequisites", items: ["A Rocky Agent runtime 0.2 or later (Claude Code)", "An HTTPS URL reachable from Dynatrace"] },
      { title: "Deployment commands", text: "Nothing to deploy. Enter the HTTPS URL, username and password below and run the connection test." },
      { title: "Environment variables", text: "Managed by whoever operates the runtime. The app needs only the URL, username and password." },
      { title: "Secret configuration", text: "Store the password as an owner-only secret, reference a Credential Vault entry, or choose “Ask every session” to keep it in memory only." },
      { title: "Networking requirements", items: ["Allow the host in Settings > General > External requests", "Use EdgeConnect for runtimes inside a private network"] },
      { title: "TLS recommendation", text: TLS },
      { title: "Health-check instructions", code: { language: "bash", content: HEALTH } },
      { title: "Cleanup instructions", text: "Delete the connection in this app. Saved sessions in Dynatrace are not affected." },
      { title: "Cost and security notes", items: ["The runtime exposes only the Rocky API; Claude Code itself never listens on a port", "A Claude subscription on a shared runtime is not allowed: use an API key or a cloud provider for teams"] },
    ],
    checklist: ["URL uses HTTPS", "Connection test passes", "Claude sign-in passes"],
  },
];
