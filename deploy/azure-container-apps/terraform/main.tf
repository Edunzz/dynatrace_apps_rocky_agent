terraform {
  required_version = ">= 1.6.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.81"
    }
  }
}

provider "azurerm" {
  features {}
  subscription_id = var.subscription_id
}

data "azurerm_resource_group" "this" {
  name = var.resource_group_name
}

data "azurerm_key_vault" "this" {
  name                = var.key_vault_name
  resource_group_name = var.resource_group_name
}

# Versionless secret URIs: Container Apps resolves them at runtime, so secret
# values never enter Terraform state (a key_vault_secret data source would).
locals {
  secret_uri = {
    dt_platform_token = "${data.azurerm_key_vault.this.vault_uri}secrets/${var.dt_platform_token_secret_name}"
    server_password   = "${data.azurerm_key_vault.this.vault_uri}secrets/${var.server_password_secret_name}"
    model_api_key     = "${data.azurerm_key_vault.this.vault_uri}secrets/${var.model_api_key_secret_name}"
  }
}

resource "azurerm_log_analytics_workspace" "this" {
  name                = "${var.name}-logs"
  location            = data.azurerm_resource_group.this.location
  resource_group_name = data.azurerm_resource_group.this.name
  sku                 = "PerGB2018"
  retention_in_days   = var.log_retention_days
}

resource "azurerm_user_assigned_identity" "this" {
  name                = "${var.name}-identity"
  location            = data.azurerm_resource_group.this.location
  resource_group_name = data.azurerm_resource_group.this.name
}

resource "azurerm_role_assignment" "kv_secrets_user" {
  scope                = data.azurerm_key_vault.this.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.this.principal_id
}

resource "azurerm_container_app_environment" "this" {
  name                           = "${var.name}-env"
  location                       = data.azurerm_resource_group.this.location
  resource_group_name            = data.azurerm_resource_group.this.name
  log_analytics_workspace_id     = azurerm_log_analytics_workspace.this.id
  infrastructure_subnet_id       = var.infrastructure_subnet_id
  internal_load_balancer_enabled = var.infrastructure_subnet_id == null ? null : !var.external_ingress
}

resource "azurerm_container_app" "this" {
  name                         = var.name
  container_app_environment_id = azurerm_container_app_environment.this.id
  resource_group_name          = data.azurerm_resource_group.this.name
  revision_mode                = "Single"

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.this.id]
  }

  # Key Vault references resolved by the managed identity at runtime.
  secret {
    name                = "dt-platform-token"
    key_vault_secret_id = local.secret_uri.dt_platform_token
    identity            = azurerm_user_assigned_identity.this.id
  }
  secret {
    name                = "server-password"
    key_vault_secret_id = local.secret_uri.server_password
    identity            = azurerm_user_assigned_identity.this.id
  }
  secret {
    name                = "model-api-key"
    key_vault_secret_id = local.secret_uri.model_api_key
    identity            = azurerm_user_assigned_identity.this.id
  }

  ingress {
    external_enabled           = var.external_ingress
    target_port                = 4096
    transport                  = "http"
    allow_insecure_connections = false

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }

    dynamic "ip_security_restriction" {
      for_each = var.allowed_ip_ranges
      content {
        name             = "allow-${ip_security_restriction.key}"
        ip_address_range = ip_security_restriction.value
        action           = "Allow"
      }
    }
  }

  template {
    # Sessions are local to one replica.
    min_replicas = 1
    max_replicas = 1

    container {
      name   = "rocky-agent"
      image  = var.image
      cpu    = var.cpu
      memory = var.memory

      env {
        name  = "DT_PLATFORM_URL"
        value = var.dt_platform_url
      }
      env {
        name        = "DT_PLATFORM_TOKEN"
        secret_name = "dt-platform-token"
      }
      env {
        name  = "OPENCODE_SERVER_USERNAME"
        value = "opencode"
      }
      env {
        name        = "OPENCODE_SERVER_PASSWORD"
        secret_name = "server-password"
      }
      env {
        name        = var.model_api_key_env
        secret_name = "model-api-key"
      }
      env {
        name  = "OPENCODE_PROVIDER"
        value = var.opencode_provider
      }
      env {
        name  = "OPENCODE_MODEL"
        value = var.opencode_model
      }
      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "LOG_LEVEL"
        value = "info"
      }

      startup_probe {
        transport               = "HTTP"
        port                    = 4096
        path                    = "/rocky/v1/livez"
        interval_seconds        = 5
        failure_count_threshold = 30
      }
      readiness_probe {
        transport        = "HTTP"
        port             = 4096
        path             = "/rocky/v1/livez"
        interval_seconds = 10
      }
      liveness_probe {
        transport        = "HTTP"
        port             = 4096
        path             = "/rocky/v1/livez"
        interval_seconds = 30
      }

      volume_mounts {
        name = "workspace"
        path = "/workspace"
      }
    }

    volume {
      name         = "workspace"
      storage_type = "EmptyDir"
    }
  }

  depends_on = [azurerm_role_assignment.kv_secrets_user]
}
