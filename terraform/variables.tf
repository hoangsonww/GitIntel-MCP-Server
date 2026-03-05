# =============================================================================
# GitIntel MCP Server — Terraform Variables
# =============================================================================

# ---------- General ----------
variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "prod"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be dev, staging, or prod."
  }
}

variable "project_name" {
  description = "Project name used for resource naming"
  type        = string
  default     = "gitintel"
}

# ---------- AWS ----------
variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "aws_vpc_cidr" {
  description = "CIDR block for AWS VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "aws_eks_version" {
  description = "Kubernetes version for EKS"
  type        = string
  default     = "1.31"
}

variable "aws_node_instance_type" {
  description = "EC2 instance type for EKS nodes"
  type        = string
  default     = "t3.medium"
}

variable "aws_node_desired_size" {
  description = "Desired number of EKS nodes"
  type        = number
  default     = 2
}

variable "aws_node_min_size" {
  description = "Minimum number of EKS nodes"
  type        = number
  default     = 1
}

variable "aws_node_max_size" {
  description = "Maximum number of EKS nodes"
  type        = number
  default     = 5
}

# ---------- Azure ----------
variable "azure_subscription_id" {
  description = "Azure subscription ID"
  type        = string
  default     = ""
}

variable "azure_location" {
  description = "Azure region"
  type        = string
  default     = "eastus"
}

variable "azure_vnet_cidr" {
  description = "CIDR block for Azure VNet"
  type        = string
  default     = "10.1.0.0/16"
}

variable "azure_aks_version" {
  description = "Kubernetes version for AKS"
  type        = string
  default     = "1.31"
}

variable "azure_node_vm_size" {
  description = "VM size for AKS nodes"
  type        = string
  default     = "Standard_D2s_v5"
}

variable "azure_node_count" {
  description = "Desired number of AKS nodes"
  type        = number
  default     = 2
}

variable "azure_node_min_count" {
  description = "Minimum number of AKS nodes"
  type        = number
  default     = 1
}

variable "azure_node_max_count" {
  description = "Maximum number of AKS nodes"
  type        = number
  default     = 5
}

# ---------- Container Image ----------
variable "container_image" {
  description = "Container image for the MCP server"
  type        = string
  default     = "mcp-git-intel"
}

variable "container_tag" {
  description = "Container image tag"
  type        = string
  default     = "latest"
}

# ---------- Feature Flags ----------
variable "enable_aws" {
  description = "Deploy AWS infrastructure"
  type        = bool
  default     = true
}

variable "enable_azure" {
  description = "Deploy Azure infrastructure"
  type        = bool
  default     = false
}
