- Self-hosters: the background-job staleness alerts in `deploy/alerts.yml` can
  fire now. They selected the app's `job` label, which a default Prometheus
  scrape renames to `exported_job`, so a job that stopped running paged
  nobody. They select on `exported_job` now. Keep `honor_labels` off in your
  scrape config, or they go quiet again.
