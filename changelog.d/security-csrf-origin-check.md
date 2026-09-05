- Every mutating API endpoint now enforces the Origin check the docs already
  promised, not just three. Cross-site requests were already blocked in
  practice by the session cookie's SameSite=Lax setting; this closes the gap
  between that and what the auth package's own comment claimed.
