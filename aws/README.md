# AWS Infrastructure — GitIntel MCP Server

## CloudFormation Stacks

Deploy in order:

```bash
# 1. ECR Repository
aws cloudformation deploy \
  --template-file cloudformation/ecr.yaml \
  --stack-name gitintel-ecr \
  --parameter-overrides Environment=prod

# 2. VPC + Networking
aws cloudformation deploy \
  --template-file cloudformation/vpc.yaml \
  --stack-name gitintel-vpc \
  --parameter-overrides Environment=prod \
  --capabilities CAPABILITY_IAM

# 3. EKS Cluster
aws cloudformation deploy \
  --template-file cloudformation/eks.yaml \
  --stack-name gitintel-eks \
  --parameter-overrides Environment=prod VpcStackName=gitintel-vpc \
  --capabilities CAPABILITY_NAMED_IAM
```

## Push Container Image

```bash
# Authenticate Docker to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com

# Build and push
docker build -t mcp-git-intel:latest .
docker tag mcp-git-intel:latest ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/mcp-git-intel-prod:v1.0.0
docker push ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/mcp-git-intel-prod:v1.0.0
```

## Connect to EKS

```bash
aws eks update-kubeconfig --name gitintel-prod --region us-east-1
kubectl get nodes
```
