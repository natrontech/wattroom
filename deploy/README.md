# Deploying WattRoom (ADR-0002: one VM, one compose stack)

First time, on the VM:

    mkdir -p /opt/wattroom && cd /opt/wattroom
    # copy this deploy/ directory here
    cp .env.example .env            # fill it (sops-managed in the homelab repo)
    cp livekit.yaml.example livekit.yaml   # real keys, same values as .env
    docker compose -f docker-compose.prod.yml up -d

Every deploy after that:

    docker compose -f docker-compose.prod.yml pull wattroom
    docker compose -f docker-compose.prod.yml up -d wattroom

The image is published to ghcr.io/natrontech/wattroom:main on every push to
main (.github/workflows/publish.yml). The server migrates its own schema at
boot, so pull + up -d is the entire deploy path.

DNS: wattroom.ch A/AAAA to the VM. Caddy takes TLS from there. Open 80, 443
(tcp+udp), 7880-7881, and LiveKit's RTC UDP range on the VM firewall.

After the first deploy, set the two GitHub repository secrets that switch on
the production synthetic (#55): PROD_URL and PUSHGATEWAY_URL. Grafana points
at the prometheus service; dashboards are the homelab's, per its own rules.
