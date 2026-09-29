- A voice channel's session controls (pick, start, pause, end and the other coach controls)
  are now rate-limited on the server, like cheers and the jukebox already
  were: one rider can send the same control at most four times a second.
  Before, a misbehaving client could repeat a workout pick as fast as its
  connection allowed, and the server re-checked every one. Riding and
  coaching are unaffected, and a tap that comes too quickly now says so.
