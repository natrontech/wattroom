# 0002 — Deploy on a single VM with docker compose, not Kubernetes

- Status: accepted
- Date: 2026-07-16
- Supersedes: WATTROOM.md decisions "Deploy" (k8s-native) and "Hosting" (Natron k8s cluster)

## Context

The founding decision was Kubernetes-native deployment on existing Natron infrastructure. Research (RESEARCH.md §2) then established that self-hosted LiveKit on k8s requires `hostNetwork: true`, direct public UDP exposure on node IPs, and doesn't support private/NAT-ed clusters — WebRTC media fundamentally fights the k8s networking model. That's real, permanent ops complexity purchased for scale properties an alpha of ≤10 riders (and a donation-funded service generally) doesn't need. The architecture is already a single Go binary + Postgres + LiveKit — three processes.

## Decision

Production runs on **one VM with a docker compose stack**: the wattroom-server image (SPA embedded), Postgres, LiveKit (host network mode — trivial on a VM), and a reverse proxy (Caddy) for TLS on wattroom.ch. Deploys are `git pull && docker compose up -d` (or a small deploy script/action). Backups are a `pg_dump` cron to off-VM storage. The k8s manifests/Helm work is dropped, not deferred as an artifact — nothing k8s-shaped gets built or maintained.

## Consequences

Easier: LiveKit networking (host ports, no hostNetwork pods, no node firewall choreography), TLS (one Caddy), operations (one machine to reason about), contributor comprehension (prod ≈ the dev compose file), and cost. The Natron-cluster entanglement question from the founding doc dissolves — any VM anywhere works, including a Swiss provider if the data-residency story ever matters.

Accepted ceilings: vertical scaling only (fine — one instance handles hundreds of rooms per the hub design, and LiveKit's benchmark covers our sizes many times over), single point of failure (acceptable for a free alpha; a training session lost to a VM reboot is annoying, not catastrophic — ride data survives via the client IndexedDB buffer), manual-ish ops. Revisit trigger: sustained >50 concurrent rooms, real uptime expectations, or a second server becoming necessary — at which point this ADR gets superseded, and the k8s research in RESEARCH.md §2 is still valid.
