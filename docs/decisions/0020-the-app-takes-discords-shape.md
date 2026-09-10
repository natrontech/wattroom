# ADR-0020: The app takes Discord's shape — one frame, one sidebar, no switchable layouts

Date: 2026-09-01 · Status: accepted (#181)

## Context

WATTROOM.md calls the product "Discord for indoor cycling" and
[ADR-0010](0010-room-first-positioning.md) locks room-first positioning: the
room is a place you idle in, not a page a session happens on. The UI has been
converging on that one issue at a time (#170 recomposition, #323 rail cleanup,
#321 jukebox in the timeline, #325 sessions) without anyone deciding it.

Two things block making it deliberate.

**The locked line.** WATTROOM.md §"Room UX" specifies _user-switchable layouts —
metrics-first, video-first, media-focus, plus TV mode_. That is a different
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
   slider and the theme cycle: they were living in a 208 px strip you also
   navigate rooms with, and the rail is navigation. The theme cycle goes behind
   the cog, with Profile, Sensors and the ramp test.

   **Leaving the rail is not the same as leaving the room.** The mixer and the
   gate are ridden with, not set up once — see the
   [2026-09-02 amendment](#amendment--the-mix-and-the-gate-come-back-into-the-room-2026-09-02),
   which supersedes this point's original reading and gives them a home in the
   room's own people column. A control you only need _before_ you ride belongs
   behind the cog; a control you discover is wrong _while_ riding gets a
   shortcut where you are standing.

3. **Every room still carries its signal** (#181 gap 4) — live dot, unread
   count, mention badge, "Sweet Spot 2×20, 12 min in", who is in voice. That is
   ADR-0010's crew radar, and it is why rooms keep **names** rather than
   becoming Discord's 48 px icons.
4. **The top section is three entries, not nine** — and the missing six are
   _retired_, not relocated. A sidebar that lists everything lists nothing.

   | Was                   | Now                     | Why                                                                                                                                                                                                               |
   | --------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `/rooms`              | the sidebar, plus a `+` | The sidebar already is the room list. All the page carried beyond it was "open a room" and "join with a code" — two actions, not a destination. Invites and medal history belong to the room's own Members place. |
   | `/sessions`           | Home                    | A cross-room list of what is coming is the second half of "what is happening", which is what Home is for. Per-room planning stays in the room's Sessions place.                                                   |
   | `/progression`        | Rides                   | One subject split down the middle: the charts on one page, the rides they are drawn from on another, and every drilldown a navigation between them.                                                               |
   | `/ramp`               | Workouts                | A ramp test is a workout you start, not a page you visit. It keeps its own screen because it writes your FTP; it is reached from the shelf.                                                                       |
   | `/pair`, `/whats-new` | the cog                 | Set up once, read once.                                                                                                                                                                                           |

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

| Focus               | When                                                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Sprint moment**   | a 15 s all-out window is armed — WATTROOM.md's "one place the UI is allowed to go loud", so it takes the screen and gives it back |
| **Game**            | the session is a game mode rather than a workout (`GamePanel`)                                                                    |
| **Shared screen**   | someone is sharing (LiveKit)                                                                                                      |
| **Your instrument** | the default, and what returns when the others end                                                                                 |

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

| Viewport | Shape                                                        |
| -------- | ------------------------------------------------------------ |
| ≥ 1280   | sidebar + content + people (240 / fluid / 272)               |
| < 1280   | people becomes the summonable sheet it already is below `xl` |
| < 768    | the sidebar becomes a drawer; content is the screen          |

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
- **The jukebox dock and a modal keep out of each other's way.** RMF wants
  the player visible while media plays and nothing of _ours_ drawn over it —
  not the player over a dialog the rider opened. So the floating dock sits
  below dialogs, drawers and toasts, and outranks only the stage while seated
  in it (#395). A modal counts itself open (`modals.svelte`); while one is,
  the dock treats a covered stage as no seat and goes to its corner, and the
  modal keeps a gutter above the dock's published height. The seat is
  re-measured every frame while offered, so a banner or a message above the
  stage moves the player with it; a fullscreen that does not contain the dock
  pauses this client's player until it exits. A new modal uses `Modal` or
  attaches `countModal`.

Also recorded: the session picker opens for **one intent** — start, or plan —
with the other a link away; starting and planning had been one modal with two
stacked sections, which is how riders stopped finding either. And a YouTube
link in the chat carries a Queue button: that is the reason a link lands in the
chat during a ride at all.

## Amendment — the mix and the gate come back into the room (2026-09-02)

Decision point 2 originally sent "the per-rider mixer, the gate slider and the
theme cycle" behind the cog together, on the grounds that all three are _desk
settings_ — set once, not reached for mid-interval. Ridden, half of that is
wrong (#477). This amendment is the authority for the mixer and the gate; the
point above now carries the rule it was missing, which is this one:

> A control is a desk setting when you only need it **before** you ride. A
> control you discover is wrong **while** riding needs a shortcut inside the
> room, whatever it costs in chrome.

The gate and the mix are the second kind, and they are the second kind for the
same reason: you cannot tell they are wrong from a desk. The gate is right
until the fan comes on. The mix is right until someone talks over music you
then cannot hear them through — which is the moment you need the music fader,
the duck depth and that rider's volume, and the moment the cog was asking you
to navigate out of the room onto a page that also holds FTP, sensors and the
theme. Riding is exactly when the levels are wrong.

So the room gets a **Sound** panel, opened from the people column beside
Join voice / Mic / Camera (`QuickAudio.svelte`): gate mode and the gate on the
shared dB axis, music, cues and duck, the riders set off unity with a reset
each, and the mic and speaker pickers. Big targets and no precision gestures
(`ux.md`) — a modal rather than a popover, because 272 px of column is not
where you drag a fader at 160 bpm, and `Modal` already keeps the jukebox dock
out of its own way.

What does not change:

- **`/profile` keeps the whole page.** The room's panel is a shortcut, never
  the only way in — the same rule `ux.md` states for the context menu. The
  camera picker, push-to-talk's explanation and the mic test's full context
  stay there.
- **One implementation, two surfaces.** `GateTune` and `MixFaders` were lifted
  out of `VoiceSettings` and are rendered by both. A second copy of a fader
  block is how the two homes drift apart.
- **The theme cycle stays behind the cog.** Nobody re-themes mid-interval; it
  was correctly classified.
- **The rail is still not where this lives.** What the original decision was
  actually right about is that these do not belong in a 208 px strip you also
  navigate rooms with. They live in the room, not in the navigation.

## Amendment — a phone reaches the room directly (2026-09-05, #412)

The Decision above answered the _phone_ question by scoping it out: a phone
is read-only, and gets a separate spectator page rather than this shell. #412
shipped a different answer, and this amendment records it rather than leaving
the Decision's text as the thing riders are told.

**What actually shipped.** A phone loads `/r/[slug]` like every other width —
the same sidebar-drawer, crew strip, places and Chat this ADR describes for a
narrow window — and `$lib/device.svelte`'s capability detection gates the
affordances that need something a phone does not have, rather than routing
the phone away from the shell entirely. There is no separate read-only
dashboard: `/r/[slug]/watch` is now a redirect _into_ `/r/[slug]` (it kept its
URL because it had been linked from the old view's footer and bookmarked
since #124), not the destination a phone lands on.

**Why this reads as better, not just different.** A phone still cannot pair a
trainer (BLE FTMS needs Web Bluetooth, iOS-Safari-only per
[ADR-0004](0004-chrome-first-with-native-escape-hatch.md)), so the rider is
still a spectator in the sense that matters — but they get the room's crew
strip, chat and reactions live rather than a stripped-down dashboard
maintained as a second surface. One shell with gated affordances beats a
parallel read-only page for the same reason switchable layouts lost earlier
in this ADR: a second surface is a second design every later change has to
keep in sync, and #383/#412 already show what happens when it does not
(`/r/[slug]/watch` drifted behind the real room and was retired).

**What does not change.** The phone still is not treated as a first-class
riding surface — this ADR's shell is still designed for a desk, and a phone
never gets the sidebar's own places re-laid-out for a thumb. `ux.md`'s huge
targets and no-precision-gesture rules still apply below `md` regardless of
device. What changes is the _mechanism_: capability gating on one shell,
not a redirect to a second one.

This amendment does not touch WATTROOM.md's phone/iOS wording — that is a
separate, still-open question ([#656](https://github.com/natrontech/wattroom/issues/656)) about how a locked founding
document records a divergence from itself. This amendment is scoped to what
this ADR itself asserted about the mechanism, which #412 made false.

## Amendment — a control lives on the thing it belongs to (2026-09-06, #874)

The amendment above put the levels back inside the room and stopped there: the
mix got a panel, and a rider's volume got a speaker icon at the end of a row.
Ridden further, that is still the wrong place — for a different reason. The
rule it was missing:

> A control that belongs to **one object** lives on that object. The panel is
> where you see what you have changed; it is not where you go to change it.

A rider's volume is a property of the rider, not of the row that happens to be
drawing them, and a row is not one place — the same person appears in the
people column, on a tile on stage, in the Members list. `RiderVolume.svelte`
existed on two of those and nowhere else, so the control was missing exactly
when you were looking somewhere else. The music level is the same mistake in
the other direction: it is a property of the jukebox, and it was in a panel
called Sound while the jukebox showed you a queue and a transport.

Every object with more than one action already has a right-click menu (#465).
So the fader becomes a menu entry: `MenuEntry` grows a slider variant that
`ContextMenuHost` draws, `personMenu` offers it for anyone in voice, and the
volume follows the rider to every surface their menu is attached to. The
speaker icon leaves the rows with `RiderVolume.svelte`. The music fader renders
in the jukebox deck under the transport, labelled as yours rather than the
room's — the transport commands everyone, the fader commands your ears.

What does not change:

- **The Sound panel stays**, and stays the second way in (`ux.md`: never only
  in a menu). Its rider list stops being a row of Reset buttons and becomes the
  faders themselves — the riders you have moved, adjustable there.
- **The gate threshold stays in it, with its meter.** _(Everything else in
  this list has since left: the cues and the duck depth in #898 and #904, the
  gate's MODE and then both device pickers to the mic and to you, #914 and
  #920 — see below.)_
- **The sidebar rail keeps its music fader.** It is the control that follows
  the music out of the room, which is the rail's whole job.

**The cues followed, one issue later (#898).** They were left in the panel here
on the grounds that no object owns them — they fire from the room, from chat,
from a poke, from a toast. That was the wrong half of the question. Nothing
_plays_ them from one place, but they belong to one thing all the same: they
are yours, per device, wherever in the app you are. The object that is you and
is pinned to every screen is the you-panel at the foot of the sidebar, so the
cue level is an entry in its menu (`you-menu.ts`), beside your rider page and
your settings. Letting the fader go plays a cue at the level it landed on —
`MenuSlider` grew an `onChange` for it — because a level you cannot hear is
not a level you can set.

**The duck depth is the same answer (#904).** How far music and cues dip under
a voice is not the jukebox's property — it dips the cues too, with an empty
queue — and it is nobody's rider level. It is your mix, so it sits under the
cue level in the same menu, offered only while there is a room connection,
because outside a room no voice can dip anything. Both homes read it the same
way round: right is off. Two surfaces for one control that disagree about
which way is louder are worse than one surface.

**The gate is where the rule stops, and the stopping is the point (#914).**
Every fader that moved was a number with a label. The gate threshold is not
one: `GateMeter` makes the slider's track the meter, so setting it is "drag
the mark under my own voice" (#289), and a closed gate is indistinguishable
from a dead mic without it. A `MenuSlider` has no meter, and giving it one
would put a second copy of `GateTune` inside the menu system — the drift this
whole amendment exists to prevent. So the threshold stays on the surfaces that
can show a level.

What did move is the part that was never a level: **how you transmit** is a
choice, and it belongs to the microphone. The mic in the you-panel has a menu
now (`mic-menu.ts`) — mute, voice activation, push-to-talk with the current
one marked, and "Tune your gate…", which opens the Sound panel where the meter
is. `QuickAudio`'s open flag lifted into `sound-panel.svelte.ts` so a second
door could exist; one `QuickAudio` is mounted at a time, so there is still one
modal. The general rule, then: _put the control on its object — unless the
control needs a picture only one surface can draw, in which case put the way
to that surface on the object._

**The device pickers followed the mode (#920)**, being the same kind of thing:
which microphone you speak through is a choice belonging to the mic, and which
device the voice comes out of is a choice belonging to your ears — there is no
speaker object in the app, and the you-panel is already where the cue level
lives. Both lists are built by `deviceOptions`, so a menu and the panel can
never disagree about what an unnamed device is called, and the output list is
drawn only where `setSinkId` exists (`av.canPickOutput`). This made the mic's
menu the first one long enough to run off a screen, so `ContextMenuHost` grew
a maximum height and scrolls; scrolling inside a menu already did not close
it, because `scrollClosesMenu` only closes on a scroller containing the
anchor.

What is left in the Sound panel is the gate threshold and the mic test — a
level that is a picture, and the button that makes the picture move.
_(That sentence never described the shipped panel — see the
[2026-09-10 amendment](#amendment--the-sound-panel-holds-the-whole-mix-not-the-leftovers-2026-09-10-2010),
which supersedes it.)_

## Amendment — the crew is a mode, not a level (2026-09-08, #1023)

[ADR-0038](0038-the-crew-is-the-layer-above-rooms.md) puts a crew above the
room, so the tree this document sized for is a level deeper:
`crew → room → place`. It said the arithmetic here had to be **re-argued rather
than quietly inherited**, and left the column count to #1023 rather than
asserting one. #1023 drew three answers at true width and this is what it
came back with.

**The decision above stands: one column.** What changes is the sentence holding
it up. This:

> Discord's shape is two columns because Discord has forty servers of thirty
> channels. WattRoom has five rooms of five places.

is now true **per crew** rather than in total. A rider has a few crews of a few
rooms, and the crew is expressed as a **mode the column is in**, not as a second
indent inside it: a switcher names the current crew at the top, and everything
below it — the rooms, the open room expanding into its places, the you panel —
is structurally untouched. The tree is three levels deep; the navigation is
still two.

### The pin, which is not polish

**The room you are standing in stays in the sidebar whichever crew is on
screen.** A mode that swapped the whole column would drop the room you are
connected to out of the navigation the moment you looked at another crew, and
fold Training two clicks away mid-session.

That is the report in #416 arriving again by a new route, and it is this
document's own first promise — _places are permanent and beside the content_ —
failing. It was found by clicking the mock rather than by reading the design,
which is the argument for having drawn it at all. Any implementation of this
amendment carries the pin, and a test that fails without it.

### The other crews still have to report themselves

[ADR-0010](0010-room-first-positioning.md) makes this strip the crew's radar —
what is live, who is in voice, what is planned. A mode shows one crew, so by
construction it hides the rest, and a radar that hides three quarters of its
sky is not one. The switcher therefore carries a summary of what the crews you
are _not_ looking at are doing. This is the cost the chosen shape pays, and it
is part of the shape rather than a later enhancement.

### What was rejected

- **Indent the crew into the same column.** Two indents truncate "Thursday
  Threshold" at 240 px where the other two shapes fit it, and three crews of
  four rooms is a column you scroll through to reach Settings.
- **A 48 px crew rail beside the column.** This is the two-strip rail the
  decision above rejected on sight, and the objection did not weaken: 48 px
  cannot say "Sweet Spot, 12 min in", so the rail spends a dot on what the
  column spells out, and the eye still has to work out which strip a click
  belongs to.

**Naming is not settled by this amendment.** #1023 asked for the word _crew_
itself to be argued — the request was _"also regarding namings etc."_ — and
that argument did not happen. It matters more than it sounds: ADR-0038 records
that the word is already in use meaning the opposite thing (`docs/SPEC.md`'s
_"a room is a crew, not an attendance register"_, and the shipped `crew-chief`
medal slug, which is a data migration rather than a string change). This
amendment settles the **shape** and takes no position on what the switch calls
the thing it switches between. The cheapest moment to change the name is before
a sidebar header ships with it in.

**The evidence was not unanimous, and pretending otherwise would age badly.**
Collapsed, the indent option is the _most_ compact of the three and still
answers "where is everyone" through a per-crew pulse — a genuinely good state,
and the strongest thing found for a shape that was not chosen. It lost on its
default rather than on its best case: a rider who never collapses anything is
the one the 240 px column has to work for.

## Amendment — the map: one tree, a parent for every page, one home per object (2026-09-09, #1335)

Eight days after this ADR the frame it decided still holds and the map under
it does not exist. A whole-app pass on 2026-09-09 (every route, the shell,
eleven flows traced with click counts, assessed against navigation research
and the rider reports since the shape shipped) measured the gap: the sidebar
draws five destinations, the crew, its rooms opened into places, and your
messages; the routes form a second tree of 25 pages, **ten of which have no
row above them**, one reachable on a desk only by right-click
(`/messages/r/[slug]`), and five retired stubs of which two still receive live
navigation (`/rooms`, from the sign-in fallback and from deleting a room).
Three names disagree with their address (Rides is `/history`, the gear says
"settings" over a page titled "Profile", "Sensors" is `/pair`). And 148 of the
682 commits since 2026-08-30 touched the shell, Home or the navigation, with
this ADR amended five times in as many days: the structure was being decided
by accretion, one rider report at a time — which is exactly what this ADR's
Context diagnosed on 2026-09-01.

This amendment writes the map down, so the next rider report is placed on it
rather than redrawing it. Nothing in the column changes shape.

### Five rules

1. **One tree.** The sidebar draws every branch. A page that is not in the
   column has a parent row in it, and that row is lit while you are there.
   A page with no parent is a bug, not a page.
2. **Places and settings.** Destinations live in the column. What you set
   once lives at `/settings`, in sections that are routes (profile, equipment,
   voice, appearance, notifications, data), behind the cog, which says
   _Settings_. Who you are lives at `/u/me` and takes the trophy case with it.
   `/profile`, `/pair` and `/trophies` redirect for one release and go
   ([#1330](https://github.com/natrontech/wattroom/issues/1330)).
3. **The room's home holds its action.** Start (coach) or Join (rider) on the
   Lounge while the room idles; while a session runs, every join affordance
   lands on Training, as the notification already does. Plan has one home,
   Sessions ([#1332](https://github.com/natrontech/wattroom/issues/1332)).
4. **One home per object.** The room's chat, the crew's invite, playlists,
   trainer pairing, TV mode: one address each; every other surface links there
   and none draws a second copy.
5. **Ends link forward.** A session's summary is the ride's page. A ramp
   result offers what its number rescaled. The Sessions place lists the past
   ([0034](0034-a-session-leaves-one-recap.md), amended today). Home's recent
   rides open the ride ([#1331](https://github.com/natrontech/wattroom/issues/1331)).

### The tree

```
┌───────────────────────────────┐
│ [W] Wadlichlepfer ⌄           │ → /crew/[id]: people · rooms · invite · settings
│ ↑ a new version is ready      │   only while one is (the desktop shell, #1235)
│ Home                          │
│ Workouts                      │ → /workouts/edit · /ride · /ramp  (Workouts stays lit)
│ Rides                         │ → /history/[id]  (the URL follows the label with #1330)
│ Music                         │ + your playlists, on the shelf, not the deck
│ Friends                       │
│ ROOMS                       + │ → open a room · join with a code · find a room
│  ● MFW 5                  3 ● │ → the unread count opens /messages/r/[slug]
│     Lounge · Chat · Training  │
│     Sessions · Members ·      │   Sessions → planned + past
│     Settings                  │
│ DIRECT MESSAGES             › │ → /messages/dm/[peer]
│ [with you in MFW 5]           │   only while connected and off the Lounge
│ Get the desktop app           │ → /download, on a desk in a browser only (#1235)
│ you · ⚙                       │ → /u/me · /settings/{profile,equipment,voice,…}
└───────────────────────────────┘
Outside the tree on purpose: /c/[code] (it arrives from outside) and /hud (the shell's window).
The two rows above without a page of their own were added after the drawing (#1862): the update row and the desktop row.
Retired once their parents exist: /profile, /pair, /trophies, and the five stubs.
```

### Three decisions taken with the map

**The crew is the header.** The logo row and the crew row shared anatomy, type
(Chakra Petch 700 at 14 px, both) and the 16 px left edge, six pixels apart,
and read as two items of one list; the crew row sat closer to the logo than to
the nav it governs. The first row of the column is now the crew: a 24 px mark,
the name at 15 px / 700, the shield when it is yours, a chevron only when there
is a second crew to switch to, 12 px to Home below. The brand leaves the
column, wordmark and mark both. The tab, the desktop title bar and the sign-in
page carry the wordmark, and the narrow-window top bar keeps it because the
drawer is shut there. The mark was first kept at the row's end for
[0005](0005-synthwave-visual-identity.md)'s job — it breathes while a session
runs — and came out the same day on the operator's review: since #1016 your
avatar and the Training row already show riding, so in the column the mark
was a second indicator, and a coloured thing beside the crew's name with no
room to breathe. A rider without a crew yet keeps the old logo row, the
day-zero state. Room rows are set in the navigation's own type — Barlow at
14 px, the room you stand in a step bolder — rather than in the display face,
which now belongs to the crew header alone, so a room reads as one more
navigation point and not as a heading of its own; and the rooms eyebrow says
"rooms", since the header above it already names the crew. The connected
room's name thereby comes down from 16 px to 14 px so the header is the
largest text in the column
([#1327](https://github.com/natrontech/wattroom/issues/1327); the three
directions drawn and the one chosen are on the sidebar canvas linked from the
issue).

**Reading a room's chat without entering it keeps its page, and gets a door.**
`/messages/r/[slug]` stays. The unread count on a room row becomes the way in,
and the right-click entry _Read the chat_ retires — with nothing unread, the
way to a room's chat is walking in. This is `ux.md`'s rule read the other
way round: a menu is a shortcut, never the sole way, so a page whose only door
was a menu entry was the violation, not the entry's removal
([#1328](https://github.com/natrontech/wattroom/issues/1328)).

**Rules 2, 3 and 5 are decided here and built in their own issues.** They
rename URLs and move controls, and each is one PR that a rider will notice;
the amendment records the direction so the PRs do not re-argue it.

### What does not change

The column count and its arithmetic. The six places. Names instead of an icon
rail. The crew as a mode with the standing room pinned (the 2026-09-08
amendment). Right-click menus on every object. Voice on a tap. The phone
getting this shell with gated affordances.

### What this amendment does not decide

Where the jukebox seats itself (column, dock or stage — a rider never chooses,
`stage-slot` does; #504 asked for that decision and got a resizable column),
and whether the crew carries a chat ([0038](0038-the-crew-is-the-layer-above-rooms.md)
says it does; nothing builds one —
[#1334](https://github.com/natrontech/wattroom/issues/1334)). Both are
`needs-human-input`.

**Revisit trigger:** a rider report that asks for a page the tree has no
parent for means the tree is wrong, not the report. Amend the tree here
first; then build.

## Amendment — the Sound panel holds the whole mix, not the leftovers (2026-09-10, #2010)

The sentence that closes #920 above reads as an inventory of the Sound panel,
and as an inventory it never was one: at the time it was written the panel
still drew the mixer and the device pickers, and it draws more of both now
(#2010). Left standing, it invites the next reader to delete working controls
until the code matches the ADR. What each amendment above actually did was give
a control a home **on its object**; none of them took the panel's copy away,
because `ux.md` forbids a control that lives only in a menu.

`QuickAudio.svelte` draws four blocks, and is meant to:

- **how you transmit** — voice activation and push to talk as two big targets,
  the second labelled with the key it needs and drawn only where there is one
  to hold (`canHoldToTalk`, #1879);
- **`GateTune`** with its meter, and the mic test that makes the meter move
  before you are in voice;
- **the whole of `MixFaders`** — music, cues, soundboard (#877), shared screens
  (#1699), how far they dip under a voice, whether your own voice dips them,
  and a fader for every rider you have moved;
- **all three `DevicePickers`** — microphone, camera (#952) and, where the
  browser can switch sinks, speakers — the same component `/settings/voice`
  draws, unnamed-device hint included (#1858, #1887).

That makes the panel the in-room twin of `/settings/voice`, assembled from the
same components, and at the same time the second door to every control that
also sits on its object: the mic's menu (mute, mode, which microphone, "Tune
your gate…"), the you-menu (cue level, duck depth, speakers) and the jukebox's
music fader. The gate threshold is the one control with no second home, for the
reason #914 gives — a menu cannot draw a meter — so it lives on the two
surfaces that can: this panel and `/settings/voice#gate`, which its own copy
links to.

So read the amendments above as _this control gained a home on its object_,
never as _this control left the panel_. Rule 4 of the map amendment is not the
counter-argument: one home per object is about **addresses** — a page and the
door to it — while a fader drawn both on its object and in the panel that shows
what you have changed is this rule working as intended.

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
  something _is_ broken, it is the only red on screen.
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
  sidebar becomes a drawer, which is what Discord does — that is the _window_
  answer. The _phone_ answer is not this shell at all — see the
  [2026-09-05 amendment](#amendment--a-phone-reaches-the-room-directly-2026-09-05-412),
  which supersedes this bullet's original reading (a redirect to a separate
  spectator page). Do not let the drawer imply the phone gets the desk shell
  unmodified.
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
