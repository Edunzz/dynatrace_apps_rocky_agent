variable "subscription_id" {
  description = "Azure subscription ID."
  type        = string
}

variable "resource_group_name" {
  description = "Existing resource group (also holds the Key Vault)."
  type        = string
}

variable "name" {
  description = "Name prefix."
  type        = string
  default     = "rocky-agent"
}

variable "image" {
  description = "Container image pinned by version or digest (never latest)."
  type        = string
  default     = "docker.io/edunzz/rocky-agent:0.2.2"
  validation {
    condition     = !endswith(var.image, ":latest")
    error_message = "Pin the image to a version or digest."
  }
}

variable "dt_platform_url" {
  description = "Dynatrace platform URL, for example https://abc12345.apps.dynatrace.com."
  type        = string
}

variable "key_vault_name" {
  description = "Existing Key Vault with the runtime secrets (RBAC authorization enabled)."
  type        = string
}

variable "dt_platform_token_secret_name" {
  type    = string
  default = "dt-platform-token"
}

variable "server_password_secret_name" {
  type    = string
  default = "server-password"
}

variable "model_api_key_secret_name" {
  type    = string
  default = "model-api-key"
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

variable "external_ingress" {
  description = "true: public HTTPS ingress; false: internal ingress (requires infrastructure_subnet_id)."
  type        = bool
  default     = true
}

variable "infrastructure_subnet_id" {
  description = "Optional subnet for a VNet-integrated environment."
  type        = string
  default     = null
}

variable "allowed_ip_ranges" {
  description = "CIDR ranges allowed to reach the ingress. Empty allows all."
  type        = list(string)
  default     = []
}

variable "cpu" {
  description = "CPU cores (1.0 recommended; 2.0 for heavy workloads)."
  type        = number
  default     = 1.0
}

variable "memory" {
  description = "Memory (must match the CPU size, for example 2Gi for 1.0 CPU)."
  type        = string
  default     = "2Gi"
}

variable "log_retention_days" {
  type    = number
  default = 30
}
