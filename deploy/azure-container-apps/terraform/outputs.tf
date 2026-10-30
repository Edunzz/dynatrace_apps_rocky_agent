output "runtime_url" {
  description = "Runtime URL to enter in the Rocky Agent app."
  value       = "https://${azurerm_container_app.this.ingress[0].fqdn}"
}
