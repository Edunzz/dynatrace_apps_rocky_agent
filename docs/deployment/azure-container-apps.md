# Deploy on Azure Container Apps

Templates: [Bicep](../../deploy/azure-container-apps/bicep/main.bicep) and
[Terraform](../../deploy/azure-container-apps/terraform/).

## What gets created

* Log Analytics workspace and Container Apps environment (optionally VNet-integrated and internal)
* User-assigned managed identity with **Key Vault Secrets User** on your existing vault
* Container App (single revision, 1 replica) with HTTPS ingress on port 4096,
  `allowInsecure: false`, optional IP restrictions, startup/readiness/liveness
  probes on `/rocky/v1/livez`, and Key Vault secret references

Secret values never appear in the template, the app definition or Terraform state.

## Prerequisites

* Resource group and a Key Vault (RBAC authorization) with the secrets
  `dt-platform-token`, `server-password` and `model-api-key` (see [secrets.md](../security/secrets.md))
* Azure CLI 2.60+ (Bicep) or Terraform 1.6+

## Deploy with Bicep

```bash
az deployment group create -g rg-rocky-agent \
  -f deploy/azure-container-apps/bicep/main.bicep \
  -p @deploy/azure-container-apps/bicep/main.parameters.json
az deployment group show -g rg-rocky-agent -n main --query properties.outputs.runtimeUrl.value -o tsv
```

## Deploy with Terraform

```bash
cd deploy/azure-container-apps/terraform
cp terraform.tfvars.example terraform.tfvars
terraform init && terraform plan -out rocky.tfplan && terraform apply rocky.tfplan
terraform output runtime_url
```

The role assignment can take a few minutes to propagate. If the first revision
fails to read Key Vault secrets, restart the revision once.

## Networking

* **External ingress (default):** Azure-managed HTTPS certificate on the app FQDN
  (add a custom domain if needed); restrict with `allowedIpRanges`.
* **Internal ingress:** set `externalIngress=false` with `infrastructureSubnetId`
  and reach the runtime through Dynatrace EdgeConnect in that VNet.

## Sizing

Start with 1.0 CPU / 2Gi; use 2.0 CPU / 4Gi for heavy workloads. Keep
`minReplicas = maxReplicas = 1`: sessions are local to one replica.

## Health checks

```bash
az containerapp show -g rg-rocky-agent -n rocky-agent --query properties.runningStatus
curl -fsS https://<fqdn>/rocky/v1/livez
az containerapp logs show -g rg-rocky-agent -n rocky-agent --follow
```

## Validation checklist

- [ ] Revision running and healthy
- [ ] Ingress FQDN answers `/rocky/v1/livez`
- [ ] Key Vault references resolve (no secret errors in the system logs)
- [ ] The app's connection test passes

## Cleanup

```bash
az group delete -n rg-rocky-agent     # only if the group holds nothing else
```

## Cost and security notes

* Container Apps compute and Log Analytics ingestion/retention are billed.
* The workspace uses an `EmptyDir` volume: it is ephemeral by design.
* Validated with `bicep build` and `terraform validate` in CI; not applied to a
  live subscription by this project.
