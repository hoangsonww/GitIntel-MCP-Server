environment            = "staging"
project_name           = "gitintel"

# AWS
enable_aws             = true
aws_region             = "us-east-1"
aws_vpc_cidr           = "10.0.0.0/16"
aws_eks_version        = "1.31"
aws_node_instance_type = "t3.medium"
aws_node_desired_size  = 2
aws_node_min_size      = 1
aws_node_max_size      = 3

# Azure
enable_azure           = false
