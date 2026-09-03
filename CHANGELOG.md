# Changelog

All notable changes to WattRoom are recorded here.

The format is [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/).
Versions are [CalVer](https://calver.org/) `YYYY.0M.MICRO` — `2026.09.1`, then
`2026.09.2`, and MICRO back to 1 next month. The number tells you _when_ a
release is from; whether it breaks anything for you is what the headings below
are for, so read Changed and Removed rather than counting digits.

Entries are written by whoever did the work, in the PR that did it, as a file
in [`changelog.d/`](changelog.d/) — one per PR, so parallel work never collides
on this file. `make release` collates them into a dated section and deletes
them. Nothing here is generated from commit
subjects on purpose: a changelog is for the person deciding whether to upgrade,
not a second copy of `git log`.

## [Unreleased]

## [2026.09.20] - 2026-09-03

### Added

- The list of who is in a room, under its name in the sidebar, is now a way in
  rather than a caption: clicking it opens that room's Members place — so the
  "+2" finally shows you the two it was hiding — and right-clicking it opens
  each rider it named straight on their own page.

### Changed

- The last emoji in the app are drawn icons now: medals on a room's members
  page, the sprint and game podiums, a Floor-is-Lava rider's remaining lives,
  the flag-a-problem button on the ride screen, and a mark of its own for each
  of the seven game modes. They keep their shape and weight on every device
  and follow your theme, instead of whatever your platform's emoji font
  decided — and a screen reader now reads the ones that used to be a bare
  glyph.

### Fixed

- The flag-a-problem button on the ride screen no longer wears the same
  magenta as your live watts, so the numbers keep the colour that makes them
  findable at arm's length.
- Refreshing the page no longer drops you out of voice. Reload while you are in
  a room's call and you come straight back into it, muted if you were muted —
  the mic is never opened for you, and the camera stays off. Only a reload does
  this: opening the room fresh, coming back after a break, or hanging up first
  all leave you out, and a rejoin never takes the mic off another tab of yours.
- Sharing your screen is now impossible to miss: a persistent red status
  strip sits above every page while your screen is live, naming the room it
  is going to and offering one big Stop, the sidebar's share button turns red
  while it is on, and the stage labels your own share "Your screen".
- Your mic no longer stops opening when a track starts. The gate still lifts
  a little while the jukebox plays, but it can never rise past the top of the
  meter, and it only lifts for riders who actually hear the music — turn your
  music down to zero and you keep the gate you set.

## [2026.09.19] - 2026-09-03

### Fixed

- The sidebar now lifts the room you are standing in as one grouped section,
  making your current room clear before its individual places.
- The sidebar now offers a **Join voice** button when you are not in voice; the mic, camera and screen-share controls appear once you are in, instead of sitting there greyed out. The people column lists everyone again — in voice, in the room, and the members who are offline — with their real faces, and the jukebox deck no longer clips its own play button when the video is on the stage.

## [2026.09.18] - 2026-09-02

### Added

- Planned sessions take an RSVP. Any member of a room can say they are in for
  one, take it back, and see who else has committed — the Sessions place lists
  them in the order they said yes. There is no maybe: you are in or you are
  not.

### Changed

- The room's right column gives its height to whatever you are actually using. The jukebox folds its picture away while the video is playing on the stage — it was a 200 px placeholder for something already on your screen — and the people list folds to a row of faces you can open, which it does by itself mid-ride where the execution bars matter. Whichever one you leave open takes the space the other gives back.
- A message now reaches you the same way wherever it comes from: a room you are standing in, a room you are not, or a DM. With the tab in front of you it arrives as a toast you can click to open the thread; behind another window it is still the browser notification. Chat in a room you have not joined used to announce nothing at all.
- Unread marks read the same everywhere — the sidebar's DM dot no longer takes the live-data accent, and a room's Chat place carries a count of what was said while you were in another place.
- Unread counts and the sidebar update the moment somebody speaks, instead of waiting up to a minute for the next refresh.
- Voice, camera, screen share, sound and leave now live in one place: the you-panel at the bottom of the sidebar, on a row of their own. The duplicate set in the people column and the lounge header's Share screen button are gone.

### Fixed

The Members place opens again in rooms where a rider has collected more than one medal in a day. It used to leave you standing in the previous place with the address bar already moved, and a shared link to it never finished loading.
- Your own rider page has a way in. Clicking yourself at the bottom of the
  sidebar opens `/u/<you>` — the level, medals and shared rides other riders
  see — the way clicking anyone else's avatar already did. The gear beside it
  still goes to settings, and your page now links to the trophy case.
- A session someone else plans now appears in the room's Sessions place and on
  everyone's Home the moment it is planned, instead of on the next reload.
  Moving or cancelling one, a role change, and a member joining or leaving
  land the same way — the room you are standing in no longer only updates for
  the person who changed it.
- The Sensors page shows your trainer. Pairing happens in a room, and the page you open to check your equipment used to list every strap and sensor except the one device the ride depends on — it now names your trainer, says when it has dropped or has gone quiet, and lets you re-pair or forget it from there. The bias buttons also say why they are dead when nothing is paired, instead of just not responding.

## [2026.09.17] - 2026-09-02

### Added

The execution meter is live during a session. Training now shows how cleanly everyone is riding their own workout, ranked and updating as you go, instead of only telling you afterwards.
- A room's chat is now a place of its own — Chat, in the sidebar under the room you are in, beside Lounge and Training. It is the same live conversation, with the whole width for reading back a session's worth of talk, room-sized reactions, and the pictures people paste; on a screen too narrow for the people column it is the chat without summoning anything.

### Changed

- The people column has handed the chat over to that place and kept what only it can do: who is here, who is in voice, the deck, and the room's reactions. Where the log used to be there is now one line — who spoke while you were elsewhere and how much you missed — that opens the chat. Three surfaces had been splitting that column's height and none of them had enough; the roster and the queue get it back.
- The room's video has one home instead of a window you had to park: it plays
  in the people column, drops into the nav rail on a window too narrow for that
  column and on every page outside the room, and rises to the stage or TV mode
  when the room is watching together — so the transport is always beside it.
  The floating pop-out is gone. In the Lounge a third layout, **Sidebar**,
  keeps the video in the people column and gives the whole room back to the
  crew; the picture in the other two is centred and no longer carries a corner
  grip — drag the divider between it and the crew instead.

### Fixed

- Opening a room on a phone showed an empty screen: the redirect that hands a phone the spectator view was also hiding the view it lands on, so the one room screen a phone is meant to get rendered nothing. It is back — and it now carries a Say something button into the room's Chat place, which a phone can stand in and type in, since talking needs none of the Bluetooth a phone browser lacks.
- Voices are back to their normal loudness, and the music dips again when somebody talks. The previous release turned off the browser's automatic gain control, which quietly took both with it.

## [2026.09.16] - 2026-09-02

### Changed

- The Strava sign-in button on the login screen is now Strava's own "Connect with Strava" button, as their brand guidelines require. Nothing about signing in changes — the button just looks the way Strava says it must, which is a precondition for raising how many riders can connect their Strava account.

### Fixed

Your ride record keeps every watt after a re-pair or a mid-session page reload — the trainer's numbers used to reach the room's tiles but vanish from the saved ride. Signing out now releases the trainer too.

## [2026.09.15] - 2026-09-02

### Added

- Add friend is now one right-click away from anyone you ride with — a tile in the lounge, a row in the people column, a name on the members page. Their page keeps its button; you no longer have to go there. The people column's menu also gained View profile, which it was missing.
- The mix and the voice gate are reachable from inside a room again: a **Sound** button beside Join voice opens the music, cue and duck faders, your gate on its meter, the riders you have turned up or down, and the mic and speaker pickers — without leaving the ride for the profile page.
- Open any past ride to see how it went — the graph with your trace, time in
  zone, the numbers and any medals — and delete one you don't want to keep.

### Fixed

- A trainer that misses one command keeps working — before, a single timeout or a Bluetooth blip could silently end ERG control for the rest of the ride, and the trainer just held its last resistance.
- Clicking a picture in a room's chat or a DM opens it big in WattRoom itself, instead of handing it to a new browser tab that took the room with it. Click it again for full size, Escape or the backdrop to come back — and the new tab is still there on right-click.
The rider tiles are legible in the light theme instead of washed out, and the small tiles in the sidebar say who is speaking, riding or muted exactly the way the big ones do.
- A right-click menu on a rider stays open. It was closing itself about a second after it opened — the room rebuilds the people it shows on every update from the server, and the menu was going away with the row it was drawn on.
Pair a trainer from Training, not just the Lounge. Riders who opened Training with nothing paired saw an instrument stuck at 0 W and had to go back a place to fix it.
Ending a session now asks first. The coach's End control ran on the first tap, and a stray thumb on a 44 px target stopped the ride for everyone in the room with no way back.
The "Open Rides" button now appears on your own profile when you haven't shared a ride yet. It was written but never rendered, so the empty state explained how to share a ride without giving you the way there.
- Zooming into a screenshare stays zoomed. The stage snapped back to 1× about
  half a second after every zoom — once per room tick — which made reading a
  chart or a settings dialog on someone else's screen impossible. The zoom now
  belongs to the picture: it returns to fit when you pick another source, or
  when the sharer stops and shares again.
- Your trainer stays paired while you browse. Opening your workouts, your
  profile or anything else outside the room quietly disconnected it, even
  though you were still standing in the room — and pairing again made the
  server treat the rest of your ride as duplicates, so the session summary and
  the execution meter stopped counting a ride you were still doing. The
  trainer now belongs to the room you are in, and is released when you leave
  it or start a solo ride.
- A paired trainer that stops delivering now says so. "Unpair trainer" used to
  be the only thing the room could show, so a trainer that dropped, that
  reconnected in a loop, or that never sent a single watt looked exactly like
  one that was working. The room now carries the same persistent banner it
  already had for a lost connection or a dropped call, with a button to pair
  again.
- Voice activation no longer cuts you off mid-sentence, and the mic meter no longer dances in a silent room. The level is now measured continuously on the audio thread instead of sampled nine times a second, the gate opens fast and closes slowly (and fades instead of cutting), and automatic gain control is off — it was raising your room's noise the moment you stopped talking.
- The room now shows who is in voice before you are. Walking into a room where three people were already talking used to read "in voice, 0", listing all of them under "in the room" instead, until you pressed Join voice yourself.

## [2026.09.14] - 2026-09-02

### Fixed

- Volume faders move smoothly. Music, cues, the duck under a voice and another
  rider's level jumped in 5 % notches — a step you cannot hear near full
  volume, and a 6 dB leap down where you set a track under someone talking.
  They now move a percent at a time, and the mixer reads out where it sits.
- Joining voice or switching your camera on and off no longer makes the room's video stutter, the floating player carries only the video instead of a face beside it, and turning your camera off hands the camera back to your machine so other apps can use it again.

## [2026.09.13] - 2026-09-02

### Fixed

- A right-click menu stays open until you use it: it no longer shuts itself about a second after opening, when the room's chat scrolled to its newest line.
- Someone whose camera is on the stage is no longer drawn a second time in the tile grid, and focusing a rider is a Stage-layout thing now — in side-by-side and the grid, everyone stays one size.

## [2026.09.12] - 2026-09-02

### Fixed

- Fixed the fault behind several odd behaviours in a room with a video playing: the player's position was fed back into the app's update cycle every frame, which could stop the room updating at all — navigating a place then changed the address without changing the page. Popping the player out also works now when the video is on the stage, where the button used to do nothing.
- On a laptop-sized window, the chat and people sheet now opens over the video on the stage instead of under it — the jukebox transport, the chat and the room's people are reachable again while something is playing.

## [2026.09.11] - 2026-09-02

### Fixed

- The jukebox panel no longer shows a blank box while the video plays on the stage: the slot the player docks into carries the track's own artwork.

## [2026.09.10] - 2026-09-02

### Fixed

- Fixed a bug from the last release: with a video on the stage, moving between a room's places changed the address but left the page where it was. The jukebox panel keeps a picture-sized box while the stage has the video — that comes back once the underlying fault is fixed — but it no longer grows with the panel and takes the chat's room.

## [2026.09.9] - 2026-09-02

### Added

Right-click now works where you would expect it: a friend in the sidebar, a member, a ride, a workout, the jukebox deck — not just a room row. Objects with nothing to offer hand the right-click back to your browser instead of swallowing it.

### Fixed

- When a browser mutes the room's music until you press play, it says so in a quiet line under the player instead of a wide magenta bar that looked like an error.
- The jukebox panel no longer keeps an empty video box when the picture is on the stage or in the popped-out window — it says where the video is and gives the room back to the chat. When the panel does hold the player, the picture keeps a sane height instead of growing with the panel.
- Messages no longer shows a second list beside the sidebar: the page is the conversation, and the sidebar you already have is the list. Right-click one of your rooms to read its chat without going in.
- The start / plan a session window uses the height of your screen again instead of stopping short above the music player.

## [2026.09.8] - 2026-09-02

### Added

- Right-click a person in the people column to message them, or a chat line to react, copy it, or queue the YouTube link in it.
- Right-click (or long-press) a room in the sidebar, a rider's tile, the stage or a track in the queue for its actions: the places of a room and leaving it, focus and message, fit / pop out / fullscreen, vote / move / remove.
- Watching together has three one-tap layouts on the Lounge — Stage, Split, Crew — so the picture or the cams get the room, remembered per device. Dragging the frame's edge still works for fine-tuning.
- Messages is a place now: every room's chat and your DMs in one list, unread
  first, and you can read and write in a room without joining it — whoever is
  in the room sees your line as if you had typed it there, and a "N new" line
  marks where you left off.
- Each rider in voice has their own volume now — from their row in the people
  column or on Members — and Join voice lives in one place, the people column.
- While you are in a room but not on its Lounge — Training, Home, a message — the sidebar shows who is with you above your own panel: cameras when they are on, who is talking, who is riding, the last to speak first.
- The sidebar names who is in each of your rooms under the room, not just how many, so you can see where your friends are before you go in.
- Every member and friend has a page now: level, energy, medals from rooms
  you share, and the rides they chose to share. Add a friend from it. Rides
  stay private until you flip one to "shared" in Rides.
- A trophy case at `/trophies`, one tap from the level tile on Home: your
  medals, ten achievements with how far along each is, where every XP came
  from, and the energy your legs have put into the trainer. XP now also
  arrives off the bike — 1 XP per five minutes in a lounge's voice channel
  (24 a day at most), 5 XP for a group session you were on the call for, and
  100–500 XP once per achievement. Riding still pays best by a wide margin.

### Changed

- A room's calendar-link reset moved under Advanced on Sessions, with a line explaining what it is for: the link carries a private key, and resetting it is for when that key leaked.
- The jukebox video plays inside the people column by default, where the deck is, instead of floating over the page; a pop-out button turns it into the draggable window when you want that, and the window has a button to put it back.
- Room icons and reactions are drawn icons now, picked from a set in Room
  settings, instead of emoji — they render the same on every device and in
  every theme. A room that already had an emoji icon or reaction keeps
  showing it as the matching drawn icon.

### Removed

- The Lounge's Leave button is gone again: the sidebar's leave icon on the room row disconnects you, and leaving a room's membership stays in its Settings.

### Fixed

- Home's "Plan a session" asks which room when you can plan in more than one, with the room you are in listed first, instead of quietly opening the first one.
- The jukebox no longer crowds the chat out of the people column: the deck is capped at under half the column, the queue shows three lines with a "+n more", and "just played" is folded until you open it.
- The start / plan a session window is wider, so the workout list and the preview stop fighting for room.
- TV mode with a video playing: the player sits in the TV's top-right corner instead of floating over the numbers.
- Joining voice, muting, turning your camera on, sharing your screen and leaving voice now sit at the top of the people column in every room, labelled — not two grey icons at the bottom of the sidebar.

## [2026.09.7] - 2026-09-02

### Added

- Your theme and light/dark choice now follow your account: pick Tron Ice on the laptop and the TV shows Tron Ice too. The light/dark/auto switch is back, on your profile next to the palette — it had gone missing with the old room rail.

### Changed

- Every page uses the full width of the window instead of a narrow column on the left: Home gets a right rail for opening rooms and what's next, workouts sit in a grid, and the ride charts sit side by side on a wide screen.
- The landing's claymation riders draw their tyres, bars and hubs in the room's own dark instead of Outrun's violet, so they sit right on Tron Ice and Miami Nights too — and a test now keeps every other colour on the theme's tokens, so a palette you pick reaches all of it.

### Fixed

- Delete and other destructive buttons are the same red in every theme instead
  of borrowing zone 6's colour, which had turned them pastel pink. Error text,
  failed-state banners and "eliminated" markers moved with them.
- Opening a direct message no longer throws an update-depth error in the console on every visit.
- The jukebox player no longer sits on top of every dialog and menu: floating, it stays under them. On the stage it now follows the stage the same frame something appears above it, and while something else is fullscreen it pauses for you instead of playing on unseen.
- You can leave a room again: a member finds "Leave room" in the room's Settings (with an undo), and the Lounge has a Leave button that disconnects you next to the TV button.
- The room you are in stays opened in the sidebar while you read a message or visit Home, so Training is one click away again instead of two.
- A theme other than Outrun no longer flashes Outrun on every page load: the last applied theme is painted before the app bundle runs.
Training zones are vivid again at the hard end. Zone 6 and 7 had faded to pale pink, so the hardest efforts were the palest thing on screen; the ramp now keeps its saturation, and every theme's zones are checked for colour-blind legibility as well as contrast.

## [2026.09.6] - 2026-09-01

### Changed

- The whole app now sits in one frame. A single sidebar holds your places, your rooms, and — for the room you are standing in — the places inside it: Lounge, Training, Sessions, Members and Settings, each with its own link. The top bar and the phone tab bar are gone, and so are five destinations: Rooms, Sessions, Progression, Ramp test and Sensors have moved into the pages they belonged to. Rides now carries the charts that were on Progression; Home carries what is planned across every room, and the forms for opening and joining one.
- Training is rebuilt around one question — am I on target. Your watts travel over a track marking the tolerance band, the interval graph runs along the bottom, and the whole crew is on screen with camera, watts, w/kg, rpm and bpm. When someone shares a screen the player takes over and your numbers move beneath it; when a sprint is armed or a game is running, that takes the screen and gives it back. The solo ride and the ramp test use the same instrument.
- Direct messages and friends are places now, not a box in the corner — a conversation shows who you are talking to, whether they are riding, and a way to join them.
- A room you are not looking at finally says so: an unread count on the rail, and the room name in bold, cleared when you open it.
- "Riding now" stops being a pink dot that read like something was broken. It is the WattRoom mark's own equalizer bars, moving.
- TV mode shows the same instrument as the training view, sized for the sofa: your watts travel over the tolerance band, so "am I on target" reads from three metres the way it reads from the saddle. One design at two distances instead of two designs.

### Fixed

- A solo ride or ramp test in light mode now darkens the whole frame, sidebar included — the ride is the cave whether or not anyone else is in it. Leaving either page mid-ride now really ends the session, so the trainer no longer keeps holding a target for a screen that is gone.
- Training: the crew strip is a row of fixed-size thumbnails again, so one other rider no longer fills the column and squeezes your instrument; sprint standings are sized for the 3 m surface.

## [2026.09.5] - 2026-09-01

### Changed

- Changelog entries are one file per pull request now, collated at release —
  so parallel work stops colliding on a single file, and an entry can no longer
  be lost in a rebase conflict.

## [2026.09.4] - 2026-09-01

### Added

- The landing page carries two live numbers: how many riders are online right
  now (it hides itself when nobody is), and the repo's real star count next to
  the GitHub link.
- `wattroom_room_riding` on `/metrics`: how many riders have sent a power
  sample in the last 10 seconds, as opposed to how many are sitting in a room.
  Anyone automating deploys can use it to avoid restarting mid-interval — a
  room between sessions no longer looks like a ride in progress.

### Fixed

- What's new no longer goes blank. Any release note that used the same code
  span twice in one line — `deploy/` did, in 2026.09.3 — took the whole page
  down with it.

## [2026.09.3] - 2026-09-01

### Added

- The room's chat now carries what the room did with its plan: a session
  planned, moved or cancelled, one starting and one finishing, and a reminder
  ten minutes before a planned session is due.

### Changed

- The room is two tabs instead of one long scroll: Room holds the shared
  screen and the rider tiles, Training holds the clock, the interval, your
  target and the graph — and a session starting takes you straight to it.
- A finished session now opens its summary over the room instead of drawing it
  below the fold, where riders watching the shared screen never saw it.
- Planning a session from the Sessions page opens the room's own picker, so
  you see the graph, the zones and the cadence bands before you commit a room
  to a workout.
- Appearance themes now recolour the whole app — surfaces, text, accents, and
  power zones — with matching dark and daylight variants instead of changing
  only two accent colours.
- The end-to-end smoke fixture is one minute of riding instead of two, which
  halves the slowest job in CI. It is a test fixture — never listed, resolvable
  by id only — so no workout anyone can pick changed length.

### Removed

- `deploy/` no longer ships an auto-updater: `wattroom-update.sh` and its
  systemd unit and timer are gone. Deploying is the operator's job — for
  wattroom.ch it lives in `janlauber/homelab` — and `deploy/` is the
  self-hosting reference and the home of the alert rules, nothing more. Pin a
  release tag in your own compose file and roll it forward however you already
  roll anything else forward.

### Fixed

- The page no longer scrolls by the height of the top nav: the room fills
  exactly what is left of the screen instead of one nav-bar too much.
- Stopping a screen share from the browser's own bar now ends it in the room.
  The button had gone on offering to stop a share that was already over, and
  the stage sat on its last frame while the room saw nothing.
- A dropped connection no longer leaves the mic button reading "on" with no
  mic behind it — which stuck permanently when the rejoin also failed.

### Security

- Corrected the 2026.09.1 note about the `/metrics` exposure: it claimed
  nothing was exposed in practice, which was wrong. wattroom.ch was already
  live, so the endpoint was public for as long as the site had been running.

## [2026.09.2] - 2026-09-01

*Reconstructed 2026-09-01: this release originally listed only the first entry
below. Six other changes shipped in it, three of them rider-visible, because
the per-PR changelog rule landed mid-flight and nothing enforced it.*

### Added

- What's new: the app shows the changelog of the version it is running, and
  says so once when a new version has landed — on the home screen, never
  during a ride.
- The room's video plays *on* the stage instead of floating over it. The
  player seats into the stage layout, and floats again — at the size and
  position you gave it — when you leave the room or scroll the stage away.

### Fixed

- Live numbers are readable on rider tiles and in TV mode. Name, watts and the
  bpm/rpm/w·kg row now sit on an edge scrim rather than on whatever the camera
  is pointing at, and TV mode no longer greys out the number while
  highlighting the unit.
- Picking a rider for the stage no longer blanks their tile. A camera track is
  deliberately mounted twice — tile and stage — and each mount was tearing the
  other one down, so both went black for as long as the pick stood.

## [2026.09.1] - 2026-09-01

*The first tagged release. WattRoom was built and deployed for months before
releases existed, so this section describes what the alpha comprises rather
than itemising the changes that got it there — those are the issue board and
the git history.*

### Added

- Solo workout player: FTMS trainer control, heart-rate/cadence/power sensor
  pairing over Web Bluetooth, a workout format with an editor and a curated
  library, interval graph with FTP scaling, a built-in ramp test, and `.fit`
  export that Strava classifies as a Virtual Ride.
- Rooms: social sign-in and profiles, persistent rooms with roles, the 1 Hz
  live dashboard, an IndexedDB crash buffer that survives a reconnect, and a
  phone spectator view behind the share link.
- Presence: LiveKit voice and camera, three room layouts plus TV mode, and a
  synced YouTube jukebox that ducks under voice — with a playlist, votes and
  play history.
- Stats and the game layer: the one-transaction ride completion pipeline, FTP
  auto-detection, a live execution meter, medals, room streaks and challenges,
  and sprint moments.
- Seven game modes with their own heroes, room-level sound packs, cheers and
  quick reactions.
- Friends and presence, direct messages, and room chat with image support.
- Personal read tokens and an MCP endpoint for your own data (ADR-0017).
- Production deploy: a single-VM compose stack behind Caddy, nightly `pg_dump`,
  tagged releases, and a systemd timer that converges the VM onto the pinned
  release and rolls itself back if the new one fails its health gate
  (ADR-0019).

### Changed

- `/api/healthz` performs a real database ping instead of always answering
  `ok`, and `/api/version` reports the release tag it was built as — both so a
  deploy can be gated on them rather than on hope.

### Security

- `/metrics` is no longer proxied to the public internet. Until this release
  wattroom.ch served rider counts and Go runtime internals to anyone who asked
  for them.

  *Corrected 2026-09-01.* This entry first claimed the exposure was caught
  before wattroom.ch was ever deployed and that nothing was exposed in
  practice. That was wrong — the site was already live, so the endpoint was
  reachable for as long as it had been running. The fix itself is unchanged;
  only the claim about impact was false.

[Unreleased]: https://github.com/natrontech/wattroom/compare/2026.09.20...HEAD
[2026.09.20]: https://github.com/natrontech/wattroom/compare/2026.09.19...2026.09.20
[2026.09.19]: https://github.com/natrontech/wattroom/compare/2026.09.18...2026.09.19
[2026.09.18]: https://github.com/natrontech/wattroom/compare/2026.09.17...2026.09.18
[2026.09.17]: https://github.com/natrontech/wattroom/compare/2026.09.16...2026.09.17
[2026.09.16]: https://github.com/natrontech/wattroom/compare/2026.09.15...2026.09.16
[2026.09.15]: https://github.com/natrontech/wattroom/compare/2026.09.14...2026.09.15
[2026.09.14]: https://github.com/natrontech/wattroom/compare/2026.09.13...2026.09.14
[2026.09.13]: https://github.com/natrontech/wattroom/compare/2026.09.12...2026.09.13
[2026.09.12]: https://github.com/natrontech/wattroom/compare/2026.09.11...2026.09.12
[2026.09.11]: https://github.com/natrontech/wattroom/compare/2026.09.10...2026.09.11
[2026.09.10]: https://github.com/natrontech/wattroom/compare/2026.09.9...2026.09.10
[2026.09.9]: https://github.com/natrontech/wattroom/compare/2026.09.8...2026.09.9
[2026.09.8]: https://github.com/natrontech/wattroom/compare/2026.09.7...2026.09.8
[2026.09.7]: https://github.com/natrontech/wattroom/compare/2026.09.6...2026.09.7
[2026.09.6]: https://github.com/natrontech/wattroom/compare/2026.09.5...2026.09.6
[2026.09.5]: https://github.com/natrontech/wattroom/compare/2026.09.4...2026.09.5
[2026.09.4]: https://github.com/natrontech/wattroom/compare/2026.09.3...2026.09.4
[2026.09.3]: https://github.com/natrontech/wattroom/compare/2026.09.2...2026.09.3
[2026.09.2]: https://github.com/natrontech/wattroom/compare/2026.09.1...2026.09.2
[2026.09.1]: https://github.com/natrontech/wattroom/releases/tag/2026.09.1
