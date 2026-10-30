output "alb_dns_name" {
  description = "Point your runtime host name (CNAME/alias) here; the certificate must match that name."
  value       = aws_lb.this.dns_name
}

output "service_name" {
  value = aws_ecs_service.this.name
}

output "log_group" {
  value = aws_cloudwatch_log_group.this.name
}
