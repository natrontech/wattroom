- The sidebar no longer gets slower the more rooms you are in, or the busier
  your rooms are. Loading it ran five separate database queries per room, and
  every message anyone posted made every signed-in rider load it again — so a
  single chat line could cost the server hundreds of queries. It is one query
  now, whatever the room count.
