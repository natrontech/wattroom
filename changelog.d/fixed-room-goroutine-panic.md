- A crash inside background work (a room's game mode, jukebox, session save,
  chat pruning, a mail send, or a server-wide housekeeping job) no longer takes
  the whole server down with every live room in it. The failure is logged with a
  stack trace, the work is restarted, and every other ride carries on untouched.
