variable "region" {
  description = "AWS region."
  type        = string
}

variable "name" {
  description = "Name prefix for all resources."
  type        = string
  default     = "rocky-agent"
}

variable "image" {
  description = "Container image, pinned by tag or digest (never latest)."
  type        = string
  default     = "docker.io/edunzz/rocky-agent:0.2.0"
  validation {
    condition     = !endswith(var.image, ":latest")
    error_message = "Pin the image to a version or digest."
  }
}

variable "vpc_id" {
  description = "VPC for the service and the load balancer."
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnets for the Fargate tasks (outbound HTTPS through NAT or VPC endpoints)."
  type        = list(string)
}

variable "alb_subnet_ids" {
  description = "Subnets for the load balancer: private subnets for an internal ALB, public subnets for an internet-facing one."
  type        = list(string)
}

variable "internal_alb" {
  description = "Create an internal ALB (recommended with Dynatrace EdgeConnect)."
  type        = bool
  default     = true
}

variable "alb_ingress_cidrs" {
  description = "CIDR ranges allowed to reach the ALB on 443. Restrict to your network or Dynatrace egress ranges."
  type        = list(string)
}

variable "certificate_arn" {
  description = "ACM certificate for the HTTPS listener."
  type        = string
}

variable "dt_platform_url" {
  description = "Dynatrace platform URL, for example https://abc12345.apps.dynatrace.com."
  type        = string
  validation {
    condition     = startswith(var.dt_platform_url, "https://")
    error_message = "Use an HTTPS platform URL."
  }
}

variable "dt_platform_token_secret_arn" {
  description = "Secrets Manager ARN holding the Dynatrace platform token."
  type        = string
}

variable "server_password_secret_arn" {
  description = "Secrets Manager ARN holding ROCKY_SERVER_PASSWORD (16+ characters)."
  type        = string
}

variable "model_api_key_secret_arn" {
  description = "Optional Secrets Manager ARN for the Claude credential (empty when using Amazon Bedrock with the task role)."
  type        = string
  default     = ""
}

variable "model_api_key_env" {
  description = "Environment variable that receives the Claude credential: ANTHROPIC_API_KEY, or CLAUDE_CODE_OAUTH_TOKEN (Claude subscription, personal use only)."
  type        = string
  default     = "ANTHROPIC_API_KEY"

  validation {
    condition     = contains(["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"], var.model_api_key_env)
    error_message = "model_api_key_env must be ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN."
  }
}

variable "claude_model" {
  description = "Optional model alias (sonnet, opus) or full name; empty uses Claude Code's default."
  type        = string
  default     = ""
}

variable "enable_bedrock" {
  description = "Run Claude Code on Amazon Bedrock with the task role (sets CLAUDE_CODE_USE_BEDROCK=1)."
  type        = bool
  default     = false
}

variable "cpu" {
  description = "Task CPU units (1024 = 1 vCPU). Use 2048 for large repositories."
  type        = number
  default     = 1024
}

variable "memory" {
  description = "Task memory in MiB. Use 4096-8192 for large repositories."
  type        = number
  default     = 2048
}

variable "ephemeral_storage_gib" {
  description = "Fargate ephemeral storage in GiB: 20 (default) or 21-200."
  type        = number
  default     = 20
  validation {
    condition     = var.ephemeral_storage_gib >= 20 && var.ephemeral_storage_gib <= 200
    error_message = "Use 20 to 200 GiB."
  }
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention."
  type        = number
  default     = 30
}

variable "autoscaling_max_capacity" {
  description = "Upper bound for CPU-based autoscaling. Sessions are local to each task, so keep 1 unless routing is session-aware."
  type        = number
  default     = 1
}

variable "tags" {
  description = "Extra tags."
  type        = map(string)
  default     = {}
}
