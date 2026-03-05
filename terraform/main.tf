# =============================================================================
# GitIntel MCP Server — Terraform Root Module
# =============================================================================

locals {
  name_prefix = "${var.project_name}-${var.environment}"

  common_tags = {
    Project     = "mcp-git-intel"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# ---------- AWS Networking ----------
module "aws_networking" {
  source = "./modules/networking"
  count  = var.enable_aws ? 1 : 0

  name_prefix = local.name_prefix
  vpc_cidr    = var.aws_vpc_cidr
  tags        = local.common_tags
}

# ---------- AWS EKS ----------
module "aws_eks" {
  source = "./modules/eks"
  count  = var.enable_aws ? 1 : 0

  name_prefix        = local.name_prefix
  kubernetes_version = var.aws_eks_version
  vpc_id             = module.aws_networking[0].vpc_id
  private_subnet_ids = module.aws_networking[0].private_subnet_ids
  node_instance_type = var.aws_node_instance_type
  node_desired_size  = var.aws_node_desired_size
  node_min_size      = var.aws_node_min_size
  node_max_size      = var.aws_node_max_size
  tags               = local.common_tags
}

# ---------- Azure AKS ----------
module "azure_aks" {
  source = "./modules/aks"
  count  = var.enable_azure ? 1 : 0

  name_prefix        = local.name_prefix
  location           = var.azure_location
  kubernetes_version = var.azure_aks_version
  vnet_cidr          = var.azure_vnet_cidr
  node_vm_size       = var.azure_node_vm_size
  node_count         = var.azure_node_count
  node_min_count     = var.azure_node_min_count
  node_max_count     = var.azure_node_max_count
  tags               = local.common_tags
}
