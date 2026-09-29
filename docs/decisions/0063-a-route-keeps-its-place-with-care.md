# 0063 — A route keeps its place, with care

- Status: accepted; settles [#3042](https://github.com/natrontech/wattroom/issues/3042)
- Date: 2026-09-29
- Replaces: the Ride Worlds draft's "a route is a shape, not a place" (never an ADR)
- Extends: [0035](0035-stored-credentials-are-sealed-with-a-key-from-the-environment.md) — sealing, with a key version and no clear-text fallback; [0053](0053-the-riders-own-uploads-travel-with-the-export.md) — routes travel with the export; [0055](0055-a-shared-ride-carries-numbers-not-words.md) — a shared ride carries no geometry
- Amends: [0030](0030-what-wattroom-emails.md) — what a mail never carries gains place names
- Beside: [0039](0039-the-public-room-directory.md) (listed crews), [0062](0062-the-horizon-may-be-a-road.md) (what a road is), [0081](0081-the-world-is-keyed-by-place.md) (the world keyed by place)
- Canon: GDPR Art. 4(1) — a location is personal data; AGENTS.md — no Strava data and no coordinates in an AI context

## Context

Jan decided on 2026-09-26 that a stored route keeps its full coordinates on
the server. The draft before it said the opposite: a route is a shape, never a
place.

A route file is where somebody lives, trains and commutes. Privacy zones alone
do not hide that: a CHI 2022 study (Mink et al.) recovered a rider's home from
only a few routes up to 68 % of the time. Keeping coordinates is acceptable
only with everything else here: sealed storage, audiences cut by the server,
zones that do not give away their centre, names that carry no place, a list of
every derived table, and erasure.

## Decision

### Sealed, or not stored at all

- Coordinates are sealed with ADR-0035's environment key, with a `key_version`
  column and a documented **re-seal** command. A route cannot be
  re-authorised the way a Strava token can, so ADR-0035's "rotation is
  re-authorisation" does not fit here.
- With **no key set, the server stores heights only and refuses
  coordinates.** It never stores them in the clear. This is the opposite of
  ADR-0035's absent-key fallback, on purpose: a missing credential costs a
  reconnect, a leaked route costs a home address.

### Who sees what

The server cuts a route to its audience before it travels.

| Audience                                            | What it gets                                                                                                                                                                                                     |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The owner                                           | the full route                                                                                                                                                                                                   |
| A crew the route is picked into                     | the road profile — heights, heading, climbs — cut to the span between the start and finish anchors, while the route is in a session or plan they can open. Heights are relative to the span's start, so absolute altitude stays with the owner |
| The public — the road board and open rides          | library routes only: no owner, no zones, never Strava-origin                                                                                                                                                      |
| Anyone else: a shared ride (ADR-0055), the og card, the recap | no geometry, no heights, no place names                                                                                                                                                                 |
| Any AI context                                      | nothing                                                                                                                                                                                                          |

- **Once a crew holds the span's coordinates** under #3096's conditions,
  relative heights protect nothing, so its tier may carry absolute heights.
  Its coverage is a corridor of at most ±1,000 m that stops at the anchor, with
  tiles withheld within max(anchor distance, 1,000 m) of the true ends and of
  any zone (#3240).
- **A listed crew asks first.** Picking a route into a crew listed in the
  public directory (ADR-0039) asks the owner once per crew: "Anyone who joins
  ⟨crew⟩ will see this route." Other people can walk into that crew, so the
  owner pays a privacy cost the click does not show, and errors.md's confirm
  rule applies. Decided by Jan, 2026-09-29.
- The world's tiles are cut per audience and cached per tile (ADR-0081).

### Zones and anchors

- A **privacy zone** is a circle of 200–1,600 m around the point it hides,
  drawn about a **fixed random offset** from it. The offset is load-bearing and
  is never dropped: without it, the centre of any circle is the home.
- By default a route hides **400 m at both ends**.
- Once the geo pack exists, each zone gets a fixed public **km-0 anchor** at
  least 1,000 m outside every zone. The hidden part rides as a nameless,
  neutral stretch.
- **World salts.** Until ADR-0081 lands, a world's salt is a per-route secret.
  Under every answer, the local cells over hidden ends and zones carry
  owner-only secrets (#3224, #3225).

### Names carry no place

- The owner's rename is shown to the owner only.
- Every other surface carries the **generated** name — numeric
  ("Road · 52.9 km · 1,312 m") until the geo pack can name places that lie
  outside every zone.
- Every place a name travels, so none is missed: the session state sent to the
  channel; the presence radar; email subjects and leads through Resend; ICS;
  the Strava title; friends' shared rides; the og title and the card's
  filename; the recap (90 days); MCP.
- **Email, ICS and Strava titles never carry a place name**, generated or not.
  This amends ADR-0030's list of what is never sent.

### Derived location data

Each derived table, and why it may stay unsealed:

| Data                   | What keeps it safe unsealed                                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rider_tiles`          | never ticks a tile inside a zone                                                                                                                                                            |
| col stamps, climb keys | point only at public OSM features outside every zone                                                                                                                                        |
| the corridor cache     | regenerable from the geo pack, and cut like the tier it serves                                                                                                                              |
| `road_segments`        | map-only: derived from the map, no personal data                                                                                                                                            |
| `segment_efforts`      | owner data that never points at a segment through its owner's zone. An effort within 1,000 m of the ride's ends is marked `near_private_end` at save; any effort within 1,000 m of any zone is hidden at read time, so a zone drawn later hides old lines at once. Exported, and erased with the ride |

### Copies that outlive the owner

- Other riders keep the metres and relative heights they rode: their ride is
  theirs.
- Plans hold only the route reference, so deleting the route empties them.
- A crew member's IndexedDB copy expires after 7 days and is capped.

### Strava, erasure, export

- A route from strava.com (a GPX from `StravaGPX`, a TCX naming Strava) rides
  **owner-only**: never picked into a session or planned. Detection is a
  heuristic, and the copy says so: "files from Strava ride owner-only".
- A route is erased when it is deleted and when the account is purged. The
  export carries routes as GPX (ADR-0053).
- The privacy page gets a bullet for routes, and `liveNumbersLine` says what a
  crew sees.

The numbers are in docs/SPEC.md's "A route's place" section. They are privacy
rules, not alpha defaults: loosening one takes an ADR.

## Consequences

- WATTROOM.md is unchanged. This is its privacy rule applied to a new kind of
  data, not a divergence from it.
- No coordinate is written (#3024) before this is on `main`.
- Rotating the key is a re-seal the operator runs, and a server with no key
  imports heights only. Both are deliberate.
- Every new surface that shows a route name, a height or a line must name its
  tier. A surface that cannot answer shows the generated name and nothing else.
- Implementation: [#3024](https://github.com/natrontech/wattroom/issues/3024)
  (storing routes), [#3051](https://github.com/natrontech/wattroom/issues/3051),
  [#3054](https://github.com/natrontech/wattroom/issues/3054),
  [#3055](https://github.com/natrontech/wattroom/issues/3055),
  [#3096](https://github.com/natrontech/wattroom/issues/3096) (a crew's span
  coordinates), [#3132](https://github.com/natrontech/wattroom/issues/3132),
  [#3240](https://github.com/natrontech/wattroom/issues/3240) (the corridor).

## Amendment, 2026-09-29 (#3250): the world is keyed by place

[ADR-0081](0081-the-world-is-keyed-by-place.md) is accepted, so the lines this
ADR left conditional on it now hold: outside private regions a world is a
function of the place and its data snapshot, not of a per-route salt; the
world's tiles are cut per audience and cached per tile; and the fixed random
offset of every privacy zone stays load-bearing. Private regions keep their
owner-only secrets in local cells, and no map data is read there.
