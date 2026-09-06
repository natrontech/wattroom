- Room pages no longer slow down as the ride history grows. The monthly kJ
  total and the room's streak both scanned every ride ever recorded, because
  the column they filter on was never indexed; on a 200 000-ride database they
  now take 0.4 ms and 0.2 ms instead of 29 ms and 16 ms. Deleting a ride, and
  deleting an account, get the same treatment.
