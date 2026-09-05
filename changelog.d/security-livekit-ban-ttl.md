- A banned rider's voice and camera access now expires within 30 minutes
  instead of staying valid for up to six hours. Ejecting a rider from the
  LiveKit call removes them from that session, but it never revoked the
  access token already in their browser; the token's own lifetime is what
  actually bounded a stale token's reach, and it was six hours.
