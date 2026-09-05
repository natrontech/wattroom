- Cue sounds now duck to 25 % under a talking rider, the level docs/SPEC.md
  names, and glide there over the same 150 ms attack / 600 ms hold / 400 ms
  release the music already used — a countdown or cheer that is sounding when
  someone speaks no longer takes an audible click in either direction. One
  module now owns every ducking number, so the mixer, the cue bus and the
  jukebox can never disagree about how deep or how fast. The mixer's tests
  also stop flaking under Node 26, where a real `localStorage` global could
  leak between test files.
