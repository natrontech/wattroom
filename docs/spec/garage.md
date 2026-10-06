# Spec: The figure and the garage

Part of the product spec. [docs/SPEC.md](../SPEC.md) indexes every section and says which values change without an ADR.

## The figure ([ADR-0073](../decisions/0073-the-rider-is-dressed-never-measured.md) — defaults, tune in alpha)

- **Proportions**: stylised athletic, about **7 heads** tall, head scale **1.08**. No face.
- **Build**: slim, athletic or strong — the rider's choice, never derived from weight.
- **Height**: the rider's choice, **1.50–2.05 m** (#3151).
- **Builds**: **3**.
- **Skin**: one of **8** free swatches, never sold; the values are [#3413](https://github.com/natrontech/wattroom/issues/3413)'s. The neutral figure's tone is none of the 8.
- **Neutral figure** (until the rider chooses): athletic build, a middle height, the neutral tone.
- **The live zone** is a flat ground ring under the bike, never the jersey.

## Wardrobe (defaults — tune in alpha; [ADR-0069](../decisions/0069-cosmetics-are-earned-never-bought.md))

**Earning Batzen** (one Batzen is a minute ridden at your own FTP):

- per ride, at most **1.2 ×** the minutes ridden (so at most **72** an hour);
- at most **180** per UTC day of the save;
- zero-watt seconds earn nothing;
- **× 1.2** in a group session.

**Grants**: **100** on welcome; an opening grant for existing riders of
min(their history, **1,500**).

**The catalogue (v3)**:

| Parameter       | Value                                                                                                |
| --------------- | ---------------------------------------------------------------------------------------------------- |
| Slots           | **39**                                                                                               |
| Price tiers     | **60 / 150 / 400 / 1,200 / 2,400** Batzen                                                            |
| Buyable items   | **122**, **29,860** Batzen in total — one discipline's complete look in about **17–24 weeks** at three rides a week |
| Earned-only     | **33** items                                                                                         |
| Parameters      | width, depth, length, height, count, lens category and colour are free on anything you own           |
| Patina          | at **25** rides                                                                                      |
| Seasons         | **8** season windows a year; a seasonal item needs **3** rides inside its window, and returns every year |
| Crew kits       | templates unlock at **100 / 500 / 2,000** crew session hours                                         |
| Undo            | within **10 min**, and only if the item has not yet been worn on a ride                              |
| UCI limits      | the 2026 limits (bars **400 mm**, rims **65 mm**, socks halfway to the knee) as information chips only |

**The Swiss calendar** (#3163), the eight windows as the v3 shop draws them.
Each is a week, its day and **3** days either side: Fasnacht (Basel's
Morgestraich, the Monday after Ash Wednesday), Chalandamarz (1 March),
Sechseläuten (the third Monday in April — a week earlier in Holy Week, a
week later on Easter Monday), the longest day (21 June), 1 August,
Samichlaus (6 December) and the longest night (21 December). Alpabzug is
all of September and October. A window is read in the rider's own zone,
counts the rides started inside it that year, and pays its item on the
third; an item earned before keeps the day it was first earned.
