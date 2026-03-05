# =============================================================================
# GitIntel MCP Server — Terraform Outputs
# =============================================================================

# ---------- AWS Outputs ----------
output "aws_vpc_id" {
  description = "AWS VPC ID"
  value       = var.enable_aws ? module.aws_networking[0].vpc_id : null
}

output "aws_eks_cluster_name" {
  description = "AWS EKS cluster name"
  value       = var.enable_aws ? module.aws_eks[0].cluster_name : null
}

output "aws_eks_cluster_endpoint" {
  description = "AWS EKS cluster endpoint"
  value       = var.enable_aws ? module.aws_eks[0].cluster_endpoint : null
  sensitive   = true
}

output "aws_ecr_repository_url" {
  description = "AWS ECR repository URL"
  value       = var.enable_aws ? module.aws_eks[0].ecr_repository_url : null
}

# ---------- Azure Outputs ----------
output "azure_aks_cluster_name" {
  description = "Azure AKS cluster name"
  value       = var.enable_azure ? module.azure_aks[0].cluster_name : null
}

output "azure_acr_login_server" {
  description = "Azure ACR login server"
  value       = var.enable_azure ? module.azure_aks[0].acr_login_server : null
}
