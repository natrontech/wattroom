- `wattroom_room_riding` is back on `/metrics`. It has been missing since
  2026.09.118, when the endpoint moved to a registry of its own and this one
  gauge kept publishing to the old one — so a deploy guard asking "is anyone
  pedalling" got no answer and, on wattroom.ch, held each release back for its
  full timeout. Self-hosters: `deploy/` now points the Prometheus job at
  `wattroom:9091` rather than the app port, which is what `deploy/alerts.yml`
  needs to fire at all, and documents `WATTROOM_METRICS_ADDR` and its `:9091`
  default.
