- Strava uploads work again on servers that set `WATTROOM_TOKEN_KEY`. Once
  that key encrypted the stored Strava sign-ins, the uploader could not read
  them, so every ride failed to reach Strava as soon as the rider's short-lived
  access token expired. Update, then retry any failed upload from the ride's
  page. Nobody needs to reconnect Strava.
