- The 3D ride world (still behind its flag) draws only the ground and road
  within 4 km of you, and builds the ground further out on a background
  thread as you ride, instead of drawing the whole route's ground and road in
  every frame. The busiest frame of the test loop drops from over 400,000
  triangles to about 280,000, and the ground now reaches 4 km in every
  direction instead of stopping 1.4 km from the road.
