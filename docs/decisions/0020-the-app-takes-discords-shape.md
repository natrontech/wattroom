# ADR-0020: The app takes Discord's shape — one frame, one sidebar, no switchable layouts

Date: 2026-09-01 · Status: accepted (#181)

## Context

WATTROOM.md calls the product "Discord for indoor cycling" and
[ADR-0010](0010-room-first-positioning.md) locks room-first positioning: the
room is a place you idle in, not a page a session happens on. The UI has been
converging on that one issue at a time (#170 recomposition, #323 rail cleanup,
#321 jukebox in the timeline, #325 sessions) without anyone deciding it.

Two things block making it deliberate.

**The locked line.** WATTROOM.md §"Room UX" specifies *user-switchable layouts —
metrics-first, video-first, media-focus, plus TV mode*. That is a different
answer to the same question a persistent structure answers: three shapes the
rider picks between, versus one shape that always holds. Both cannot be true.

**Two shells, not one.** Today the app renders two frames. Outside a room:
rail | top-nav + content. Inside a room: rail | main | chat. The rail is the
only thing they share, and the top nav — eight destinations in a horizontal
strip — exists only in the first. So the room feels like somewhere you are and
every other page feels like a website, in the same session, one click apart.

The specific gaps #181 names all fall out of those two facts: the room's places
are tabs inside the content instead of a column beside it; there is no member
list because the right column is spent on chat; nothing signals a room you are
not looking at; `RoomLive.svelte` is 1171 lines because one component holds a
header, a tab strip, a stage, a grid and a session dashboard.

The constraint that makes this non-obvious is `.claude/rules/ux.md`. Discord's
density is designed for a mouse at a desk. Ours has to work at three metres
with a heart rate of 160.

## Decision

**One frame for the whole app. Layout switching retires.**

```
┌────────────────┬────────────────────────┬───────────┐
│ sidebar        │ content                │ people    │
│                │                        │  + talk   │
│  Home          │                        │           │
│  Workouts      │                        │           │
│  Rides         │                        │           │
│  Progression   │                        │           │
│                │                        │           │
│  YOUR ROOMS    │                        │           │
│ ● 🔥 Thursday   │                        │           │
│   │ Lounge     │  ← the room you are    │           │
│   │ Training   │    in opens in place   │           │
│   │ Sessions   │                        │           │
│   │ Members    │                        │           │
│   │ Settings   │                        │           │
│   🚴 mfw-5  12 │                        │           │
│   🌄 Sunday    │                        │           │
│                │                        │           │
│ ┌────────────┐ │                        │           │
│ │ you  🎙 📷 ⚙ │ │                        │           │
└─┴────────────┴─┴────────────────────────┴───────────┘
      240px              fluid                272px
```

**Discord's shape is two columns because Discord has forty servers of thirty
channels. WattRoom has five rooms of five places.** Copying the two-strip rail
literally was built first and rejected on sight in `/dev/shape`: it spends
384 px of chrome to navigate nine things, and the eye has to work out which
strip a click belongs to before it can aim. Two vertical navigations side by
side read as confusion, not as structure. The tree fits in one column, so it
gets one.

What the merge does **not** give up — these were the whole point:

1. **Places are permanent and beside the content** (#181 gap 1). The room you
   are standing in expands in place: Lounge, Training, Sessions, Members,
   Settings. The tab strip inside `RoomLive` retires into it, and **`TopNav`
   and `MobileNav`'s destination list are deleted** — the sidebar is the app's
   navigation on every screen, so a destination has exactly one home.
2. **The you panel is pinned at the bottom** (#181 gap 2) — avatar, mic, cam,
   voice status, cog. What leaves the rail is the per-rider mixer, the gate
   slider and the theme cycle: desk settings that were living in a 208 px strip
   you also navigate rooms with. They go behind the cog, with Profile, Sensors
   and the ramp test.
3. **Every room still carries its signal** (#181 gap 4) — live dot, unread
   count, mention badge, "Sweet Spot 2×20, 12 min in", who is in voice. That is
   ADR-0010's crew radar, and it is why rooms keep **names** rather than
   becoming Discord's 48 px icons.
4. **The top section is three entries, not nine** — and the missing six are
   *retired*, not relocated. A sidebar that lists everything lists nothing.

   | Was | Now | Why |
   | --- | --- | --- |
   | `/rooms` | the sidebar, plus a `+` | The sidebar already is the room list. All the page carried beyond it was "open a room" and "join with a code" — two actions, not a destination. Invites and medal history belong to the room's own Members place. |
   | `/sessions` | Home | A cross-room list of what is coming is the second half of "what is happening", which is what Home is for. Per-room planning stays in the room's Sessions place. |
   | `/progression` | Rides | One subject split down the middle: the charts on one page, the rides they are drawn from on another, and every drilldown a navigation between them. |
   | `/ramp` | Workouts | A ramp test is a workout you start, not a page you visit. It keeps its own screen because it writes your FTP; it is reached from the shelf. |
   | `/pair`, `/whats-new` | the cog | Set up once, read once. |

   What is left is Home, Workouts, Rides — plus your rooms, your messages, and
   the cog.

**Riding is motion, not a coloured dot.** A magenta dot beside a green presence
dot reads as a traffic light, and this palette's pink end sits close enough to
the danger ramp (`z6`) that the first thought is "something is broken" — rider
feedback, and it is correct. The fix is the form, not the hue: "riding now"
becomes the **equalizer bars from the WattRoom mark**, animating, which
ADR-0005 already defines as the quiet "a session is running" signal. Errors do
not dance. Green stays presence, `z6` stays reserved for faults, and the same
indicator is used everywhere riding appears — the rail, the roster, the friends
list, Home.

**Training has a focus slot, and always shows the crew.** The focus is normally
your own instrument: the watts number travels horizontally over a track marking
the tolerance band, so "left or right of the bright slot" reads before any digit
does. When someone shares a screen or the jukebox plays a video, **the player
takes the focus and the instrument collapses to a bar beneath it — never over
it**, because the RMF rules in WATTROOM.md forbid anything overlaid on the
player. That is the old "media-focus layout", except the room enters it when
there is media rather than making the rider pick it from a menu.

Underneath the focus, always, the **crew**: a camera thumb and live watts,
w/kg, rpm and bpm for every rider. A group-training surface that shows only
your own numbers is a solo app with a chat window attached.

The focus slot pays for itself four times, and this is what makes it a shape
rather than a special case for video. It holds, in priority order:

| Focus | When |
| --- | --- |
| **Sprint moment** | a 15 s all-out window is armed — WATTROOM.md's "one place the UI is allowed to go loud", so it takes the screen and gives it back |
| **Game** | the session is a game mode rather than a workout (`GamePanel`) |
| **Shared screen** | someone is sharing (LiveKit) |
| **Your instrument** | the default, and what returns when the others end |

Cheers (`CheerLayer`) stay an overlay across all four — they are the room
reacting, not a thing to look at.

**The jukebox is frame-level, not a place — and that is a licence term, not a
preference.** WATTROOM.md's YouTube RMF rules require the player tile to be
≥ 200 × 200, always visible while media plays, never overlaid, and never
auto-advancing while offscreen. A place goes offscreen the moment you open
another one, so the jukebox cannot be one. There is also exactly one player
instance — moving an iframe between DOM parents remounts it and stops playback
— so it cannot travel into the Training focus slot either. It docks bottom-
right at 360 px (200 px tall at 16:9 needs 356 px, which is why it fits in
neither the 240 px sidebar nor the 272 px people column) and it stays put.
Content reserves that gutter rather than letting the player sit on top of live
data. The Training focus slot is therefore for **shared screens**, not for the
jukebox.

**Content is one column, one job, no tabs.** What was a tab is now a place with
a URL — and that includes the two surfaces that were neither a tab nor a page:

- **A DM is a place, not a drawer.** `DmDrawer.svelte` retires. Today a
  conversation is a 320 × 384 box pinned bottom-right, with a `right-[392px]`
  in its class list so it does not land on the jukebox dock — it cannot show
  who you are talking to, its scrollback is a thumbnail, and it is a mode you
  have to remember you are in. That is the same argument this ADR makes against
  switchable layouts, applied to a conversation. Nothing is lost by promoting
  it: the room connection survives navigation (#191), so opening a thread does
  not drop you out of the room or out of voice, and mid-ride you are in the
  cave where typing is off the table anyway (`ux.md`).
- **Friends is a place too.** It is currently a section at the bottom of
  `/home`, under your week's numbers — which is where you look for numbers, not
  for people. It becomes the `friends` entry beside the sidebar's messages
  section, with online / all / requests and your code.

The sidebar's messages section is already the DM list, so promoting both costs
a destination each and no new chrome.

**People and talk is one column, roster stacked above chat**, in a room only —
#181's third gap. The roster has to be there without being asked for; that is
the whole "this room is populated" read, and a Chat/Members toggle only shows
it to someone who already suspected they wanted it. Members as a column of
their own — the literal reading of "a fourth column" — was the other candidate
and loses on the budget below: it takes content to 530 px at 1280 px, which the
tile grid does not survive.

The budget: 1280 − 240 − 272 = **768 px of content**, against 624 px for the
two-column version. The ladder is by media query, never a setting (`ux.md`,
the 95 % rule):

| Viewport | Shape |
| --- | --- |
| ≥ 1280 | sidebar + content + people (240 / fluid / 272) |
| < 1280 | people becomes the summonable sheet it already is below `xl` |
| < 768 | the sidebar becomes a drawer; content is the screen |

**Switchable layouts retire.** WATTROOM.md's "metrics-first / video-first /
media-focus" is superseded. Metrics-first is the Training place, video-first is
the Lounge with a rider focused, media-focus is the stage with a shared screen
on it — three named layouts turn out to be three places, and a place you can
link to beats a mode you have to remember you are in. **TV mode survives
unchanged** as the only alternate render, because it is not a layout preference:
it is a different viewing distance.

**Discord's information architecture, not Discord's skin.**
[ADR-0005](0005-synthwave-visual-identity.md) is untouched — Outrun palette,
Chakra Petch over Barlow, `--color-watt` glows on live data only, `--color-neon`
structural and never glowing. Nothing here adopts blurple, Discord's type or its
iconography.

**The density rule that keeps this honest: chrome is Discord-dense, the training
surface is not.** Columns 1, 2 and 4 may be 11px and tight — they are read at
desk distance between efforts. Column 3 during a session is read at three metres
and obeys `ux.md` in full: huge tap targets, no precision gestures, no typing.
The `.cave` scope already marks exactly that boundary, and it keeps doing so.

## The mock is gone (2026-09-01)

`/dev/shape` did its job — every screen of the shape rendered on the real
components, so the members column, the two-strip nav and the sprint takeover
were decided by looking rather than by argument. Once the shape shipped, the
app moved past the mock on Home, the Lounge, the picker and the jukebox within
a day, and a second copy of every screen that drifts is debt nobody maintains.
It was deleted in the same PR that shipped the shape (#383); its shared pieces
— `Instrument`, `SecondaryRow`, `RidingBars` — had already moved into `$lib`.
The app is the reference. The mock is in that PR's history if a screen ever
needs to be argued about again.

## Amendments — riding the shipped shape (2026-09-01)

Two rules that were not in the mock and only showed up in the real thing:

- **Pages fill the column.** Pages used to pick their own `max-w` and centre
  it, so the content block moved around as you navigated — that is what made
  them feel like separate sites inside one sidebar. The first fix was one
  capped width anchored left; ridden on a wide screen it read as a page that
  never finished loading (#417). So `page` bakes in the padding and no width:
  content runs the column, and a section that would stretch too far goes
  multi-column at `xl` instead — Home's right rail, the workout cards, the
  ride charts. A new route does not choose a width, and never centres.
- **The jukebox dock and a modal keep out of each other's way.** The dock is
  above everything because RMF wants the player visible while media plays, so
  a modal may not bury it — which put it straight over the session picker's
  action bar. A modal counts itself open (`modals.svelte`); while one is, the
  dock treats a covered stage as no seat and goes to its corner, and the modal
  keeps a gutter above the dock's published height. Nothing hidden, nothing
  overlaid. A new modal uses `Modal` or attaches `countModal`.

Also recorded: the session picker opens for **one intent** — start, or plan —
with the other a link away; starting and planning had been one modal with two
stacked sections, which is how riders stopped finding either. And a YouTube
link in the chat carries a Queue button: that is the reason a link lands in the
chat during a ride at all.

## Consequences

- **The room stops being a special page.** One shell renders every route, so
  navigating out of a room is a column-3 swap rather than a different app. The
  #181 complaint that it "still doesn't feel like a lounge" is largely this:
  the lounge felt temporary because leaving it changed the furniture.
- **Three components and five destinations stop having a reason to exist**,
  rather than being refactored: `TopNav.svelte`, `MobileNav.svelte`'s
  destination list, `DmDrawer.svelte`, and the `/rooms`, `/sessions`,
  `/progression`, `/ramp` and `/pair` routes. Each existed to give something a
  home the shape did not otherwise provide. Nine destinations become three.
- **The status vocabulary gets smaller, not larger.** Green means present,
  moving bars mean riding, and the `z6` end of the ramp is left alone — so when
  something *is* broken, it is the only red on screen.
- **`RoomLive.svelte` splits by construction.** Its header, tab strip, stage,
  grid and training dashboard become the shell plus one component per place.
  The 1171-line file is not refactored on purpose; it stops having a reason to
  exist. Same for the top nav.
- **A destination has exactly one home.** Today "Sessions" is a top-nav entry,
  a room card and a modal inside the room. In the new shape it is a place in
  the sidebar, and `/sessions` is the same place with no room selected.
- **One instrument, everywhere you ride.** The group session, the solo ride and
  the ramp test were three designs for one activity — two big number panels in
  two of them, a needle over a tolerance band in the third. They share
  `Instrument` now, with the ramp swapping the word "target" for "step".
- **Every screen owes four states.** `errors.md` already required loading /
  error / empty / content on every page and persistent (never toast) status for
  ride-critical faults; the mock carries them, so the implementation has
  something to copy rather than something to remember.
- **A narrow window and a phone are different questions.** Below `md` the
  sidebar becomes a drawer, which is what Discord does — that is the *window*
  answer. The *phone* answer is unchanged and is not this shell at all:
  WATTROOM.md scopes phones as read-only spectators, and `/r/[slug]` already
  redirects them to `/r/[slug]/watch`. Do not let the drawer imply the room is
  usable on a phone.
- **Column count is a real budget**, and it is what killed the literal copy.
  One sidebar leaves 768 px at 1280 px; two leave 624 px. That is also the
  number the members question was decided against — members as a column of their
  own takes content down to 530 px, which the mock showed is not survivable.
- **Voice stays a state you carry, not a place you join.** #181 raises this and
  the answer is no: a training room has one conversation, and making voice a
  sub-room would put the crew in two of them. What was missing is not a voice
  channel — it is a visible roster of who can hear you, which column 4 now is.
- **Accepting:** three shapes were mocked and dropped — the two-strip nav, the
  Chat/Members toggle, and members as their own column. They are deliberately
  not kept as toggles: once a decision is made, an alternative living in the
  mock is a second design every implementation PR has to keep in sync. The
  reasoning is here; the markup is in this PR's history.
- **Revisit trigger:** if riders start using column 2 as a tab strip — clicking
  back and forth mid-interval — the places are wrong, not the shape. That is
  the signal to merge Lounge and Training rather than to bring switching back.
