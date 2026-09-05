- Coming back to a backgrounded tab no longer yanks the jukebox playhead by
  your machine's clock skew and then back again: the returning tab re-measures
  the room's position on server time, from the clock estimate it learned while
  on screen, instead of falling back to its own wall clock for the first second.
