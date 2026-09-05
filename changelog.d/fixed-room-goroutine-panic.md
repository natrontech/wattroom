- A crash inside one room's background work (game mode, jukebox, session save,
  chat pruning or a mail send) no longer takes the whole server down with every
  live room in it. The failure is logged with a stack trace, the room's clock is
  restarted, and every other ride carries on untouched.
