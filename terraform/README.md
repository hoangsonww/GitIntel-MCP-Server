# Terraform Infrastructure — GitIntel MCP Server

## Quick Start

```bash
cd terraform

# Initialize
terraform init

# Plan for an environment
terraform plan -var-file=environments/prod.tfvars -out=plan.out

# Apply
terraform apply plan.out
```

## Environments

| File | Description |
|------|-------------|
| `environments/dev.tfvars` | Single-node AWS only, minimal resources |
| `environments/staging.tfvars` | 2-node AWS, moderate resources |
| `environments/prod.tfvars` | Multi-node AWS + Azure, full HA |

## Module Structure

```
terraform/
  main.tf                   Root module — wires modules together
  variables.tf              All input variables with validation
  outputs.tf                Cluster endpoints, ECR/ACR URLs
  providers.tf              AWS + Azure + K8s providers
  environments/             Per-environment variable files
  modules/
    networking/main.tf      AWS VPC, subnets, NAT, flow logs
    eks/main.tf             AWS EKS, node group, ECR, IRSA
    aks/main.tf             Azure RG, VNet, ACR, AKS, Log Analytics
```

## Remote State (Recommended)

Uncomment the backend block in `providers.tf` and configure:

```bash
# Create S3 bucket for state
aws s3api create-bucket --bucket gitintel-terraform-state --region us-east-1

# Create DynamoDB table for locking
aws dynamodb create-table \
  --table-name gitintel-terraform-locks \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST
```

## Feature Flags

- `enable_aws = true/false` — Toggle AWS stack
- `enable_azure = true/false` — Toggle Azure stack

Both can run simultaneously for multi-cloud deployments.
