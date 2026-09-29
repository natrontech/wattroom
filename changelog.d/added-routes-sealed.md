- The server can now keep riders' routes (GPX and TCX), ready for importing
  a route in the app. A route's map is sealed with `WATTROOM_TOKEN_KEY`, and
  only its owner can open it. A server without that key keeps a route's
  heights and never its map. Deleting a route or the account erases it, and
  the data export now includes each route as a GPX file. If you rotate the
  key, run `/wattroom reseal-routes` once with the old key in
  `WATTROOM_TOKEN_KEY_PREVIOUS`; deploy/README.md has the steps.
