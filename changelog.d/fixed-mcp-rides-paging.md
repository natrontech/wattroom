- A coach model reading your rides over MCP can now page past the first
  answer, and does not step over a ride at the boundary. `list_rides` read a
  page cursor it never told anyone about, and the one it asked callers to
  rebuild was accurate only to the second.
