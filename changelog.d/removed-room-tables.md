- The database no longer holds the old room tables. Nothing changes for
  riders, and old room links still open where the room went. This release's
  migration can't be undone, though: roll back only to 2026.09.128 (the
  release before, which no longer reads those tables), and keep the database
  dump the deploy takes first.
