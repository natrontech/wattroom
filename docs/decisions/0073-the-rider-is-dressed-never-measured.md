# 0073 — The rider is dressed, never measured

- Status: accepted; settles [#3065](https://github.com/natrontech/wattroom/issues/3065)
- Date: 2026-09-29
- Diverges from: WATTROOM.md §1 — "no avatars"; marked there for the figure
- Keeps: [0048](0048-the-riders-numbers-are-asked-for-and-a-guess-says-so.md) — weight is the rider's number, and never shapes anything else
- Beside: [0066](0066-the-world-is-the-ride-view.md) (the world), [0069](0069-cosmetics-are-earned-never-bought.md) (what is never sold), [0072](0072-light-in-the-world.md) (world colours are tokens), [0076](0076-shared-roads-not-an-open-world.md) (open rides)
- Decided on 2026-09-29, taking the recorded recommendations: proportions, when the rider is asked, and the neutral figure

## Context

WATTROOM.md says "no avatars". The SPEC glossary settles the words: an
**avatar** is the profile picture, and the 3D person on the road is a
**figure**. The world puts a figure under every rider, and a figure has a
body.

Zwift sized bodies from BMI, and riders found it hurtful: the app measured
them and showed everyone the result. WattRoom asks for weight because the
physics needs it (ADR-0048), and that is exactly why weight must never draw a
body.

## Decision

### A figure is chosen, never derived

- **Stylised athletic proportions**, about **7 heads tall** (head scale
  **1.08**). Nobody is drawn realistically enough to be measured.
- The rider **chooses** a **build** — slim, athletic or strong — and a
  **height**. Neither is ever derived from weight (ADR-0048).
- **Skin tone** is one of **8 free swatches**, and is never sold (ADR-0069).
- **No face.**
- **The name label is the authoritative identity**, not the body.

### The rider is asked once, before the road

- One **skippable** card before the rider's **first ride with a road** asks
  for build, height and skin tone, so nobody meets a body picked for them.
  Skip is as large as Save. The garage's You tab changes the answer later.
- Until a rider chooses, the figure is the **neutral** one: the athletic
  build, a middle height, and a neutral stylised tone that is **none of the
  8 swatches**, so nobody is given a skin tone by default.

### Identity is in the kit

- **Who a rider is shows in the kit on the body.** The live zone moves off the
  jersey onto a **flat ground ring** under the bike. This amends the Ride
  Worlds design note "the jersey is the live zone" (decision 15).
- A **stranger on an open ride** (ADR-0076) takes hue and silhouette from their
  coarse kit, never from `hueOf(id)` (#3308).

The proportions are in docs/SPEC.md's "The figure" section. The height range
and the eight swatch values are not decided yet; they are
[#3413](https://github.com/natrontech/wattroom/issues/3413)'s, and land in the
same section, never only in code.

## Consequences

- A rider's body in the world is one they picked, and nothing about it tells
  anyone their weight.
- The figure can wear anything the garage offers, because identity is in the
  kit and the zone is on the ground.
- WATTROOM.md §1's "no avatars" is marked: there is a figure on the road now,
  dressed and chosen by the rider, never measured.
- Implementation: the figure body
  ([#3070](https://github.com/natrontech/wattroom/issues/3070)), the first-ride
  ask ([#3342](https://github.com/natrontech/wattroom/issues/3342)), the
  garage's You tab ([#3159](https://github.com/natrontech/wattroom/issues/3159)).

## Amendment, 2026-09-29 (#3151): the height range is recorded

The height range was recorded after all, in #3151's SPEC proposals: **1.50–2.05
m**, with 3 builds. It is in docs/SPEC.md's "The figure" section. Only the eight
swatch values and the neutral tone remain
[#3413](https://github.com/natrontech/wattroom/issues/3413)'s.
