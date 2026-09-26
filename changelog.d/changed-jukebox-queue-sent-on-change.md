- A voice channel with playlists queued now uses a fraction of the data it
  did. The jukebox queue is sent when it changes, not every second: with a few
  long playlists queued, each second's update drops from about 14–25 KB to
  about 0.2 KB, which matters most for a phone on mobile data over a two-hour
  ride.
