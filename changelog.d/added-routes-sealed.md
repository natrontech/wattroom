- The server can now keep riders' routes (GPX and TCX), ready for importing
  a route in the app. A route's map and its full road, with every turn and
  its height above sea, are sealed with `WATTROOM_TOKEN_KEY`, and only its
  owner can open them. A server without that key keeps only a route's
  heights, measured from its start, and never its map. An account keeps up
  to 200 routes, adding at most 10 a minute. Deleting a route or the account
  erases it, and the data export now includes each route as a GPX file. If
  you rotate the key, run `/wattroom reseal-routes` once with the old key in
  `WATTROOM_TOKEN_KEY_PREVIOUS`; deploy/README.md has the steps.
