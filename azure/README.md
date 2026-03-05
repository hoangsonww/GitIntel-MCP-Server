# Azure Infrastructure — GitIntel MCP Server

## ARM Template Deployment

Deploy in order:

```bash
# 1. Create resource group
az group create --name gitintel-prod-rg --location eastus

# 2. ACR
az deployment group create \
  --resource-group gitintel-prod-rg \
  --template-file arm/acr.json \
  --parameters environment=prod

# 3. VNet
az deployment group create \
  --resource-group gitintel-prod-rg \
  --template-file arm/vnet.json \
  --parameters environment=prod

# 4. AKS (requires VNet subnet ID from step 3)
az deployment group create \
  --resource-group gitintel-prod-rg \
  --template-file arm/aks.json \
  --parameters environment=prod \
    vnetSubnetId="/subscriptions/SUB_ID/resourceGroups/gitintel-prod-rg/providers/Microsoft.Network/virtualNetworks/gitintel-prod-vnet/subnets/aks-subnet"
```

## Push Container Image

```bash
# Authenticate to ACR
az acr login --name mcpgitintelprod

# Build and push
docker build -t mcp-git-intel:latest .
docker tag mcp-git-intel:latest mcpgitintelprod.azurecr.io/mcp-git-intel:v1.0.0
docker push mcpgitintelprod.azurecr.io/mcp-git-intel:v1.0.0
```

## Connect to AKS

```bash
az aks get-credentials --resource-group gitintel-prod-rg --name gitintel-prod-aks
kubectl get nodes
```
