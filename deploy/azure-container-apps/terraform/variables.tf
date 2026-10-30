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
  default     = "ghcr.io/edunzz/dynatrace_apps_rocky_agent:0.1.0"
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
  description = "ANTHROPIC_API_KEY, OPENAI_API_KEY or OPENCODE_API_KEY."
  type        = string
  default     = "ANTHROPIC_API_KEY"
}

variable "opencode_provider" {
  type    = string
  default = "anthropic"
}

variable "opencode_model" {
  type    = string
  default = "anthropic/claude-sonnet-4-5"
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
