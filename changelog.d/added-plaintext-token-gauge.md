- The server now says how many stored Strava refresh tokens are still
  unencrypted: `wattroom_identities_plaintext_refresh_tokens` on the metrics
  listener, plus a log line whenever the number changes. Zero means
  `WATTROOM_TOKEN_KEY` is set and every stored credential is sealed; anything
  higher means credentials are sitting in the clear in your database dumps,
  and `deploy/alerts.yml` now carries a rule that tells you so.
