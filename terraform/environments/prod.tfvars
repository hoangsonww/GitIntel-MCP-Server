environment            = "prod"
project_name           = "gitintel"

# AWS
enable_aws             = true
aws_region             = "us-east-1"
aws_vpc_cidr           = "10.0.0.0/16"
aws_eks_version        = "1.31"
aws_node_instance_type = "t3.medium"
aws_node_desired_size  = 2
aws_node_min_size      = 2
aws_node_max_size      = 5

# Azure
enable_azure           = true
azure_location         = "eastus"
azure_vnet_cidr        = "10.1.0.0/16"
azure_aks_version      = "1.31"
azure_node_vm_size     = "Standard_D2s_v5"
azure_node_count       = 2
azure_node_min_count   = 2
azure_node_max_count   = 5
