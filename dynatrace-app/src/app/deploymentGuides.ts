// Deployment guidance shown on the welcome page. Kept in sync with deploy/ and
// docs/deployment/ in the repository.
//
// The entropy-based secret detector flags variable names and file
// placeholders below; this file contains no secret values.
/* eslint-disable noSecrets/no-secrets */

export const IMAGE = "ghcr.io/edunzz/dynatrace_apps_rocky_agent:0.1.0";
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
read -rs ROCKY_PASSWORD && printf 'user = "opencode:%s"\\n' "$ROCKY_PASSWORD" | \\
  curl -fsS -K - https://rocky-agent.example.com/global/health`;

const ENV_ITEMS = [
  "DT_PLATFORM_URL: https://<environment-id>.apps.dynatrace.com (required)",
  "DT_PLATFORM_TOKEN: platform token (dt0s16.…) of a dedicated service user; see “Dynatrace platform token” for scopes (required, secret)",
  "OPENCODE_SERVER_PASSWORD: at least 16 characters (required, secret)",
  "OPENCODE_SERVER_USERNAME: default opencode",
  "OPENCODE_MODEL / OPENCODE_PROVIDER: for example anthropic/claude-sonnet-4-5",
  "ANTHROPIC_API_KEY, OPENAI_API_KEY or OPENCODE_API_KEY: model provider credential (secret)",
  "AWS_REGION (+ task role) for Amazon Bedrock",
  "NODE_ENV=production, LOG_LEVEL=info, OPENCODE_PORT=4096, WORKSPACE_PATH=/workspace",
];

const TLS = "Terminate TLS at the load balancer, ingress or reverse proxy with a publicly trusted certificate. Dynatrace App Functions always verify certificates and cannot trust a private CA; private runtimes must be reached through Dynatrace EdgeConnect or a gateway with a public certificate.";

export const DEPLOYMENT_GUIDES: DeploymentGuide[] = [
  {
    id: "local",
    title: "Local (Docker Compose)",
    summary:
      "Fastest way to try Rocky Agent: the runtime runs on your computer with Docker Compose and this app runs locally with dt-app dev. It works because dt-app dev executes the app functions on your computer, where http://localhost:4096 is reachable. The app installed in your Dynatrace environment runs its functions in Dynatrace and cannot reach your localhost.",
    docsPath: "docs/deployment/local.md",
    sections: [
      { title: "Prerequisites", items: ["Docker Desktop or Docker Engine with Compose", "Node.js 20+ and Git", "A Dynatrace SaaS environment and a platform token (see “Dynatrace platform token”)", "A model provider key (or OpenCode Zen free models)"] },
      {
        title: "Deployment commands",
        code: {
          language: "bash",
          content: `git clone ${REPO}.git
cd dynatrace_apps_rocky_agent
cp .env.example .env            # set DT_PLATFORM_URL, DT_PLATFORM_TOKEN and a model provider
docker compose up --build -d    # runtime on http://127.0.0.1:4096

cd dynatrace-app
npm ci
DT_APP_ENVIRONMENT_URL=https://<environment-id>.apps.dynatrace.com npm start   # dt-app dev opens the app`,
        },
      },
      { title: "Environment variables", items: [...ENV_ITEMS.slice(0, 2), "NODE_ENV=development in .env: an empty OPENCODE_SERVER_PASSWORD uses the documented development default", ...ENV_ITEMS.slice(4, 6)] },
      { title: "Secret configuration", text: "Keep secrets in .env (git-ignored, readable only by you). Never commit it." },
      { title: "Networking requirements", items: ["Port 4096 is published on 127.0.0.1 only", "In the local app connect to http://localhost:4096 (plain HTTP is accepted for localhost only)", "Outbound HTTPS from Docker to Dynatrace and the model provider"] },
      { title: "TLS recommendation", text: "Not needed on localhost. To use the installed app with a runtime on your computer, expose it over HTTPS with a tunnel you trust or EdgeConnect, or pick another option." },
      { title: "Health-check instructions", code: { language: "bash", content: "docker compose ps                      # rocky-agent should be healthy\ncurl -fsS http://127.0.0.1:4096/rocky/v1/livez" } },
      { title: "Cleanup instructions", code: { language: "bash", content: "docker compose down -v   # also removes the workspace volume and every ephemeral session" } },
      { title: "Cost and security notes", items: ["No cloud cost; the runtime uses your machine (about 2 GiB RAM)", "Only for local development: never publish port 4096 beyond localhost"] },
    ],
    checklist: ["docker compose ps shows rocky-agent healthy", "dt-app dev opened the app in your browser", "Test connection with http://localhost:4096 passes"],
  },
  {
    id: "codespaces",
    title: "GitHub Codespaces",
    summary:
      "Open the repository in a codespace: it asks for your environment and tokens, deploys this app to your Dynatrace environment and can start the runtime inside the codespace.",
    docsPath: "docs/deployment/codespaces.md",
    sections: [
      { title: "Prerequisites", items: ["GitHub account with Codespaces", "Platform token with app-engine:apps:install and app-engine:apps:run to deploy the app", "Optional: runtime platform token and a model provider key to start the runtime"] },
      {
        title: "Deployment commands",
        text: "Create the codespace with “New with options” to enter the parameters, or answer the prompts of the Rocky Agent setup task in the terminal. Re-run it any time:",
        code: { language: "bash", content: "bash .devcontainer/setup.sh" },
      },
      { title: "Environment variables", items: ["DT_ENVIRONMENT_URL: https://<environment-id>.apps.dynatrace.com", "DT_APP_PLATFORM_TOKEN: token used only to deploy the app", "DT_PLATFORM_TOKEN, OPENCODE_SERVER_PASSWORD, model provider key: only to start the runtime"] },
      { title: "Secret configuration", text: "Store the values as Codespaces secrets for this repository (Settings > Secrets > Codespaces) so new codespaces receive them automatically. The setup writes the runtime values to a git-ignored .env with mode 0600." },
      { title: "Networking requirements", items: ["The installed app can only reach a runtime in the codespace if port 4096 is made Public and the forwarded host (<codespace>-4096.app.github.dev) is allowed in Settings > General > External requests", "Prefer a cloud deployment for anything beyond a demo"] },
      { title: "TLS recommendation", text: "Codespaces serves forwarded ports over HTTPS with a public certificate. Keep the runtime password strong when the port is public." },
      { title: "Health-check instructions", code: { language: "bash", content: "docker compose ps\ncurl -fsS http://127.0.0.1:4096/rocky/v1/livez" } },
      { title: "Cleanup instructions", text: "Stop or delete the codespace. To remove the app from your environment: cd dynatrace-app && npx dt-app uninstall." },
      { title: "Cost and security notes", items: ["Codespaces compute and storage are billed to your GitHub account", "A public port is reachable by anyone with the URL; the gateway still requires the password", "Delete the codespace when you are done"] },
    ],
    checklist: ["Setup finished without errors", "App visible in your Dynatrace environment", "Runtime healthy in the codespace (optional)"],
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
      { title: "Networking requirements", items: ["Publish 4096 on 127.0.0.1 only and expose it through the HTTPS proxy", "Allow the runtime host in Dynatrace: Settings > General > External requests", "Outbound HTTPS from the container to your Dynatrace environment and model provider"] },
      { title: "TLS recommendation", text: TLS },
      { title: "Health-check instructions", code: { language: "bash", content: HEALTH } },
      { title: "Cleanup instructions", code: { language: "bash", content: "docker rm -f rocky-agent\ndocker volume rm rocky-workspace   # deletes the workspace and every ephemeral session\nshred -u rocky.env" } },
      { title: "Cost and security notes", items: ["Recommended: 1 vCPU, 2 GiB RAM; large repositories need 2 vCPU and 4–8 GiB", "Never expose port 4096 directly to the Internet", "Rotate OPENCODE_SERVER_PASSWORD and the platform token regularly"] },
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
  --from-file=OPENCODE_SERVER_PASSWORD=./password.txt \\
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
    summary: "Connect to a Rocky runtime or a compatible OpenCode server that is already running.",
    docsPath: "docs/deployment/existing-runtime.md",
    sections: [
      { title: "Prerequisites", items: ["A Rocky Agent runtime (recommended) or OpenCode 1.19+ served with basic authentication", "An HTTPS URL reachable from Dynatrace"] },
      { title: "Deployment commands", text: "Nothing to deploy. Enter the HTTPS URL, username and password below and run the connection test." },
      { title: "Environment variables", text: "Managed by whoever operates the runtime. The app needs only the URL, username and password." },
      { title: "Secret configuration", text: "Store the password as an owner-only secret, reference a Credential Vault entry, or choose “Ask every session” to keep it in memory only." },
      { title: "Networking requirements", items: ["Allow the host in Settings > General > External requests", "Use EdgeConnect for runtimes inside a private network"] },
      { title: "TLS recommendation", text: TLS },
      { title: "Health-check instructions", code: { language: "bash", content: HEALTH } },
      { title: "Cleanup instructions", text: "Delete the connection in this app. Saved sessions in Dynatrace are not affected." },
      { title: "Cost and security notes", items: ["Without the Rocky gateway the raw OpenCode API (including terminal endpoints) is exposed to anyone with the password", "Status indicators and policy overlays need the Rocky gateway"] },
    ],
    checklist: ["URL uses HTTPS", "Connection test passes", "Rocky gateway detected (recommended)"],
  },
];
