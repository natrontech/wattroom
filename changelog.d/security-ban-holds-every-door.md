- A ban now holds at every door. A banned rider could delete their own
  membership row by "leaving" the room and rejoin as a fresh member, and could
  still read the chat backlog, post lines and upload images over HTTP while
  banned. Leaving is refused for banned riders, the row can no longer be deleted
  through that path, and every chat endpoint now refuses banned members the
  same way the room socket, playlists and RSVPs already did.
