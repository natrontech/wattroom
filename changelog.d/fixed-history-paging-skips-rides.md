- Loading older rides in your history no longer steps over one. Two rides that
  started inside the same second sat on either side of a page boundary and the
  second of them was silently left out of the list, so a ride you rode was
  missing from /history with nothing to say so. Saving a ride twice from one
  start is now refused by the database as well, not just by the server.
