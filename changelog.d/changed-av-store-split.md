- The room's voice and video code is no longer one 1400-line file. Device
  choice, the outgoing audio bus, the mic-gate settings and the stage now
  live in modules of their own, each under test for the first time —
  including the rules about forgetting an unplugged microphone and about the
  gate rising while music plays, which previously had no coverage at all. No
  behaviour changes.
