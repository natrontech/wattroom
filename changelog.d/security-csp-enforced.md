- WattRoom's Content-Security-Policy is now enforced by the browser rather than
  only reported on: scripts, styles, fonts, ride audio, workers and embedded
  frames may come only from WattRoom itself and the official YouTube player, so
  an injected script has nowhere to load from. Which image hosts are allowed
  stays report-only for now — a sign-in picture from Google, GitHub or Strava is
  served by them, not by us, and locking that down without breaking those faces
  needs WattRoom to serve them itself first.
