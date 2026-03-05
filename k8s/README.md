# Kubernetes Manifests — GitIntel MCP Server

## Structure

```
k8s/
  base/                     Base manifests (Kustomize)
    namespace.yaml          Namespace with Pod Security Standards
    serviceaccount.yaml     SA with IRSA/Workload Identity annotations
    configmap.yaml          Environment configuration
    deployment.yaml         Pod spec with security hardening
    service.yaml            ClusterIP service
    hpa.yaml                Horizontal Pod Autoscaler
    pdb.yaml                Pod Disruption Budget
    networkpolicy.yaml      Default-deny + allow internal
    kustomization.yaml      Base kustomization
  overlays/
    dev/                    1 replica, minimal resources
    staging/                2 replicas, moderate resources
    prod/                   3 replicas, full HA, strict PDB
```

## Deploy

```bash
# Dev
kubectl apply -k k8s/overlays/dev

# Staging
kubectl apply -k k8s/overlays/staging

# Production
kubectl apply -k k8s/overlays/prod
```

## Security Hardening

- Pod Security Standards: `restricted` profile enforced at namespace level
- Non-root user (UID 1001)
- Read-only root filesystem
- All capabilities dropped
- Seccomp profile: RuntimeDefault
- No service account token auto-mount
- Network policies: default-deny ingress/egress, allow only DNS + internal
- Topology spread constraints for zone distribution
- Pod anti-affinity for host distribution

## Scaling

| Environment | Replicas | HPA Min | HPA Max | PDB minAvailable |
|-------------|----------|---------|---------|------------------|
| dev         | 1        | 1       | 3       | 0                |
| staging     | 2        | 2       | 5       | 1                |
| prod        | 3        | 3       | 10      | 2                |
