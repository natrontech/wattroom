- Revoking WattRoom on Strava's own site now disconnects it here too. Until
  now only the disconnect in Settings forgot the Strava sign-in and the ids of
  uploaded activities; revoking at strava.com left both with us, and every
  later ride failed its upload five times over. Operators: set
  `WATTROOM_STRAVA_WEBHOOK_TOKEN` and create the Strava subscription described
  in `deploy/.env.example` so a revocation is heard the moment it happens.
