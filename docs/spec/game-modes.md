# Spec: Game modes

Part of the product spec. [docs/SPEC.md](../SPEC.md) indexes every section and says which values change without an ADR.

## Game mode parameters (defaults — tune in alpha)

| Mode            | Parameters                                                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Backyard Ramp   | 3-min rounds, start 80 % FTP, +5 % FTP/round; eliminated after 10 s continuously below band; eliminated riders get 50 % FTP ERG and stay in the session                                     |
| Floor is Lava   | Called zone (Coggan 7-zone); leaving the zone >5 s burns a life; 3 lives; zone changes every 2 min                                                                                   |
| Watt Golf       | 9 holes (default — tune in alpha); "hit X W for 10 s, starting in 20 s"; meter hidden from 20 s before to hole end; strokes = mean absolute deviation in watts; targets 60–110 % FTP |
| Sprint Roulette | 10–15 s sprints, random gap 3–8 min (the first 20–60 s in, so the game starts moving), klaxon 3 s before; **5 sprints**, then the podium; scored on best 5 s w/kg |
| Points Race     | Fixed **2-min intervals**; **4 sprints** arriving roulette-style, 5 pts/3/2/1; best interval-execution 3 pts; time-in-zone streak 1 pt/interval |
| Team Relay      | One rider "on front" at 110 % FTP (others 55 %); rotate on 60–90 s timer or call-out; the session's distance = Σ front-seconds × front-watts                                                  |
| Collective Ramp | Backyard rules on the **session-average** %FTP; line starts 75 %, +4 %/round; score = rounds survived                                                                                   |

Elimination modes: 30 s disconnect grace (IndexedDB buffer proves continued pedalling on reconnect).

Alone, a game shows your own score; medals need three riders (Medals, above). Watt Golf, Floor is Lava and Backyard Ramp start from the solo ride's door, in the rider's lounge (#3276).
