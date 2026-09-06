- The app no longer re-downloads itself on every cold load. Its hashed
  JavaScript and CSS were served with no cache headers at all — not even a
  validator to ask "has this changed" with — so every fresh visit pulled the
  whole shell again. They are now cached for a year, which is safe because a
  new build writes new filenames. The reference `deploy/Caddyfile` also gains
  `encode zstd gzip`; self-hosted instances were serving everything
  uncompressed.
