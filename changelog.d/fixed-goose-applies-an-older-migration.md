- The server no longer refuses to start when a migration written earlier than
  one the database has already applied arrives later — it applies the late
  arrival at boot and carries on. Two branches whose migrations merged in the
  opposite order to the one they were written in used to leave the next
  release unable to boot, rolled back by the health gate until someone edited
  `goose_db_version` by hand. Nothing to do on upgrade.
