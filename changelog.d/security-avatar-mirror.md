- Your sign-in picture from Google, GitHub or Strava is now copied into
  WattRoom once and served by WattRoom. Until now your browser fetched that
  picture straight from the provider every time a room, roster, chat or friends
  list drew your face — which told them which room you were in and at what
  minute, on every visit. Nothing reaches a provider's servers any more, and
  existing accounts are converted the first time the upgraded server starts. A
  picture that cannot be copied leaves your initial in its place, and you can
  always upload one of your own.
- With those pictures served by WattRoom, the last piece of the
  Content-Security-Policy is now enforced rather than only reported on: an
  image may come only from WattRoom itself and the handful of hosts the app
  knowingly draws media from, so an injected image has nowhere to send your
  address. The second, report-only header is gone — it was worth carrying only
  while one directive was still waiting on this change.
