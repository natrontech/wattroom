- An MP3 whose tag is built to be slow to read can no longer stall the server.
  The tag is read before the upload takes a database connection, and a tag of
  more than 256 frames, or with a genre over 256 bytes, leaves the title to the
  filename.
