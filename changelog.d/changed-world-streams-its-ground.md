- The 3D ride world (still behind its flag) draws the ground and road around
  you as you ride instead of the whole route's in every frame: the road and
  the detailed ground within 4 km, plainer ground out to 10 km, the far part
  built on a background thread. The busiest frame of the test loop drops
  from over 400,000 triangles to about 250,000, and a long route's ground no
  longer stops 1.4 km from the road.
