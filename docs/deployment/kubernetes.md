# Deploy on Kubernetes

Manifests: [deploy/kubernetes](../../deploy/kubernetes/) (Kustomize).

| File | Purpose |
|---|---|
| `base/namespace.yaml` | Namespace with the **restricted** Pod Security Standard |
| `base/serviceaccount.yaml` | Service account without an automounted token |
| `base/configmap.yaml` | Non-secret configuration |
| `base/secret.example.yaml` | Example only (not applied) |
| `base/pvc.yaml` | 20 GiB workspace |
| `base/deployment.yaml` | 1 replica, non-root, read-only root filesystem, no privilege escalation, `capabilities.drop: [ALL]`, seccomp, probes, requests/limits |
| `base/service.yaml` | ClusterIP on 4096 |
| `base/ingress.yaml` | TLS ingress (nginx + cert-manager annotations) |
| `base/networkpolicy.yaml` | Ingress only from the ingress controller; egress only DNS and HTTPS |
| `examples/production` | Overlay setting host, environment and image |
| `examples/autoscaling/hpa.yaml` | HPA example (see the warning inside) |

## Prerequisites

* Kubernetes 1.28+, an ingress controller and cert-manager (or another TLS source)
* A secret management approach for production (External Secrets, Sealed Secrets, CSI driver)

## Deploy

```bash
kubectl apply -f deploy/kubernetes/base/namespace.yaml
kubectl -n rocky-agent create secret generic rocky-agent-secrets \
  --from-file=DT_PLATFORM_TOKEN=./token.txt \
  --from-file=OPENCODE_SERVER_PASSWORD=./password.txt \
  --from-file=ANTHROPIC_API_KEY=./anthropic.txt
# Edit examples/production/kustomization.yaml (host, DT_PLATFORM_URL, image digest)
kubectl apply -k deploy/kubernetes/examples/production
```

## Networking

* The NetworkPolicy assumes the ingress controller runs in the `ingress-nginx`
  namespace and DNS in `kube-system`; adjust the selectors for your cluster.
* Egress excludes private ranges. If your Dynatrace environment or model
  provider is reached privately, add those CIDRs.
* App Functions call the runtime from Dynatrace; if you restrict the ingress
  by source range, include the ranges that need access, or use EdgeConnect.

## Health checks

```bash
kubectl -n rocky-agent get pods
kubectl -n rocky-agent logs deploy/rocky-agent | grep -E '\[FAIL\]|Dynatrace connection'
curl -fsS https://rocky-agent.example.com/rocky/v1/livez
```

Startup, readiness and liveness probes use `/rocky/v1/livez`; it needs no
credentials and returns only `ok` or `unavailable`.

## Scaling

Keep `replicas: 1`. Sessions live inside one pod, and the Dynatrace App's
functions do not keep cookies, so cookie affinity cannot pin a session. Scale
vertically (requests 1 CPU/2Gi, limits 2 CPU/4Gi by default).

## Validation checklist

- [ ] Pod `Ready` and not restarting
- [ ] Certificate issued for the ingress host
- [ ] NetworkPolicy applied and the pod can still reach Dynatrace and the model provider
- [ ] The app's connection test passes

## Cleanup

```bash
kubectl delete -k deploy/kubernetes/examples/production
kubectl delete namespace rocky-agent    # also deletes the PVC and its data
```

The manifests are rendered and validated with `kubeconform -strict` in CI.
