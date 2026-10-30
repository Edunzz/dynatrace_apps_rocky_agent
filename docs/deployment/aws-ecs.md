# Deploy on Amazon ECS (Fargate)

Templates: [Terraform](../../deploy/aws-ecs/terraform/) and
[CloudFormation](../../deploy/aws-ecs/cloudformation/rocky-agent.yaml).

## What gets created

* ECS cluster (Container Insights), Fargate task and service (1 task)
* Application Load Balancer, HTTPS listener (`ELBSecurityPolicy-TLS13-1-2-2021-06`, ACM certificate), target group with health check on `/rocky/v1/livez`
* Security groups: ALB accepts 443 from the CIDRs you allow; tasks accept 4096 only from the ALB and send only HTTPS out
* CloudWatch log group (30 days)
* Task execution role that can read **only** the listed Secrets Manager ARNs; task role (optionally allowed to invoke Bedrock)
* Optional CPU target-tracking autoscaling (disabled by default)

The task runs as UID 10001 with a read-only root filesystem, all capabilities
dropped, and task-scoped volumes for `/workspace`, `/home/rocky` and `/tmp`.

## Prerequisites

* VPC with private subnets and outbound HTTPS (NAT gateway or VPC endpoints)
* ACM certificate for the runtime host name
* Secrets in Secrets Manager (see [secrets.md](../security/secrets.md))

## Deploy with Terraform

```bash
cd deploy/aws-ecs/terraform
cp terraform.tfvars.example terraform.tfvars    # VPC, subnets, certificate, secret ARNs
terraform init
terraform plan -out rocky.tfplan
terraform apply rocky.tfplan
terraform output alb_dns_name                   # create a DNS alias for your host name
```

## Deploy with CloudFormation

```bash
aws cloudformation deploy --stack-name rocky-agent \
  --template-file deploy/aws-ecs/cloudformation/rocky-agent.yaml \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    VpcId=vpc-0123 PrivateSubnetIds=subnet-a,subnet-b AlbSubnetIds=subnet-a,subnet-b \
    CertificateArn=arn:aws:acm:... DtPlatformUrl=https://abc12345.apps.dynatrace.com \
    DtPlatformTokenSecretArn=arn:aws:secretsmanager:... ServerPasswordSecretArn=arn:aws:secretsmanager:... \
    ModelApiKeySecretArn=arn:aws:secretsmanager:...
```

## Networking

* **Internal ALB (default)** + Dynatrace EdgeConnect in the VPC: nothing is exposed publicly.
* **Internet-facing ALB:** set `internal_alb = false` / `InternalAlb=false`,
  use public subnets for the ALB and restrict `alb_ingress_cidrs` to the
  ranges that must reach it; consider AWS WAF.

## Sizing

| Workload | CPU | Memory | Ephemeral storage |
|---|---|---|---|
| Start | 1 vCPU (1024) | 2 GiB | 20 GiB (Fargate default) |
| Large repositories | 2 vCPU (2048) | 4–8 GiB | 21–50 GiB |

Keep one task: sessions are local to each task, and App Functions do not keep
cookies, so ALB stickiness cannot route a session back to its task.

## Health checks

* ALB target group: `GET /rocky/v1/livez` (no credentials), matcher 200.
* Container health check: `/opt/rocky/healthcheck.sh` (authenticated `/global/health`).
* Logs: `aws logs tail /ecs/rocky-agent --follow`.

## Validation checklist

- [ ] Target group shows the task as healthy
- [ ] The host name resolves to the ALB and the certificate matches
- [ ] Task definition shows `secrets` (no plaintext values in `environment`)
- [ ] The app's connection test passes

## Cleanup

```bash
terraform destroy      # or: aws cloudformation delete-stack --stack-name rocky-agent
```

Secrets Manager secrets are not deleted by the templates.

## Cost and security notes

* Fargate, the ALB, NAT data processing and CloudWatch Logs are billed.
* Use a task role for Bedrock instead of static AWS keys.
* These templates are validated with `terraform validate` and `cfn-lint` in CI;
  they have not been applied to a live account by this project.
