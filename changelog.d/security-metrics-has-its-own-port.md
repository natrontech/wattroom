- `/metrics` now has its own listener on port 9091 and is no longer served on
  the app's port, where only an edge proxy's configuration kept rider counts
  and runtime internals off the internet. **Operators upgrading must move their
  Prometheus job and any deploy check from `:8080/metrics` to `:9091/metrics`**
  — the old address answers a 404 that says so. `WATTROOM_METRICS_ADDR` changes
  the port; the empty string turns the listener off.
