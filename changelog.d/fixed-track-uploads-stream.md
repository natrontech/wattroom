- Uploading music no longer holds whole tracks in the server's memory. A
  track went into memory in full before anything was checked, so a few large
  uploads at once could starve the server — and the database beside it — mid
  ride. Tracks are now written to disk as they arrive, one upload per rider
  at a time, and an upload that stalls is cut off after ten minutes.
