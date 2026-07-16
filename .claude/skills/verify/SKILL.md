---
name: verify
description: Verify a WattRoom change end-to-end by running the real app, not just tests. Use before committing nontrivial changes to server or web code.
---

# Verify a change in the running app

1. `make test && make lint` — baseline. Race detector is on; flaky-under-race means broken.
2. Static path (fastest full-stack check):
   - `make build` (embeds the frontend), run `./bin/wattroom-server`
   - `curl localhost:8080/api/healthz` → `ok`
   - Open `http://localhost:8080` — the page loads and "ping server" returns ok (proves SPA embed + API wiring)
   - SPA fallback: `curl -s localhost:8080/anything` returns index.html
3. Dev path (for iterating on the change): `make infra` once, then `make dev-server` + `make dev-web`, exercise the changed flow at `http://localhost:5173`.
4. WS/room changes: open two browser tabs on the same room route and confirm both receive ticks; kill one tab and confirm the server logs the leave and the other tab keeps ticking.
5. Protocol changes: `make protocol` then `git diff --exit-code web/src/lib/protocol.ts` must show the regenerated file was committed.
6. BLE-layer changes: run with the simulated trainer (dev flag). Real-hardware verification (Kickr Core) is required before merge only if the FTMS/WCPS encoding itself changed — say so in the PR either way.

Done = the affected flow observed working, not "tests pass".
