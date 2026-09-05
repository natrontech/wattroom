- The friends list no longer runs two extra database queries per online
  friend — loading it now costs a small, constant number of queries no matter
  how many friends are online.
