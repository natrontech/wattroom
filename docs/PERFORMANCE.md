# Measuring what an element costs

A 6 px glow on three 11 px bars cost up to a third of an M2 Max GPU. On the same machine, a 1080p screen share cost under 2% (#2998). You can't work out what an element costs by reading its code; it has to be measured. Two commands do it, on every display attached:

- **`make perf`** measures the app's real components one at a time. It says which element costs what.
- **`make perf-scenes`** measures whole screens as a rider sees them. A crew's voice channel fills up step by step: people in voice, their statuses, someone riding, someone talking, a screen share, then your own ride. It says what a rider pays, and what a fix is worth in practice.

To see where a frame goes on the screen in front of you, turn on the overlay (`?perf`) and record a trace: the next two sections. For the world's frame budget headless, `make world-bench` and `make voice-bench` ("The world on the slow rig").

## In the running app: `?perf`

Add `?perf` to any app address (`/ride?road=intro&perf`, `/crew/…/v/…?perf`). The tab keeps it through reloads and navigation (sessionStorage); `?perf=0` turns it off. Off, nothing is observed and nothing is marked: every hook is one false check, read once when the app loads.

A box in the bottom-right corner, above the now bar, takes no clicks and shows the last five seconds:

| Line | What it is |
|---|---|
| **page** | Animation frames a second and the interval between them, p50 / p95 / max. Below the display's rate, something held the main thread or the frame's commit |
| **long tasks** | Tasks over 50 ms (`PerformanceObserver('longtask')`): how many, their total and the longest |
| **world** | The world's own frames a second (30 riding; standing, 15 while rain falls or someone waves in sight, else 1: loop.ts), the share of its 30 fps intervals missed, the quality rung and pixel ratio |
| **draws · tris · tex · geo · prog** | three.js's `renderer.info` for the last frame: draw calls, triangles, textures, geometries, shader programs |
| **video** | Videos with a picture, their decoded and dropped frames a second, the largest in MP: camera tiles and the stage |
| **`wattroom:` table** | Each named span: runs a second, ms a run p50 / p95, and ms a second, busiest first |
| **held** | The two longest animation frames of the last 10 s and the script that ran longest in each (Long Animation Frames); `rendering` when no script did |

The spans, around the hot paths (`web/src/lib/perf/trace.ts`):

| Span | Around |
|---|---|
| `world-frame` | One world frame: `world-advance` (the sim, rig, riders, ground) then `world-draw` (three.js submitting it) |
| `lounge-frame` | One frame of the lounge's pixel room (15 fps) |
| `channel-message` | A voice channel's socket message, through the Svelte update it causes (the tick is one a second) |
| `trainer-sample` | A trainer sample, real or simulated, through everything it feeds and the HUD's Svelte update |

Each span is also a `performance.measure('wattroom:<name>')`, so a Chrome or Electron Performance trace names it in its Timings track. Only with `?perf`: the browser keeps every measure until it is cleared, and the world alone makes 90 a second, so always-on marks would grow a two-hour ride's heap or put a clear on the frame path, for a trace nobody records. With the flag, each name's measures are cleared every 600; a trace has them already.

**The overlay costs a little:** its own animation frame on every vsync (how it counts the page's frames) and a repaint of the box twice a second. Read GPU numbers with it off.

`window.wattroomPerf` is the bench's handle: `summary()` is the overlay's numbers, `world()` the live world's stats, renderer info and frames.

## A trace in the desktop app

1. **Open DevTools:** View → Toggle Developer Tools (⌥⌘I on macOS; Ctrl+Shift+I on Windows and Linux, whose frameless window keeps the menu's shortcuts).
2. **Turn the marks on** in its Console, as the window has no address bar: `sessionStorage.setItem('wattroom.perf.v1', '1'); location.reload()`. The overlay appears; `removeItem` and reload turn it off.
3. **Record:** Performance → ⏺, ride for 5–10 s, stop. The `wattroom:` spans are in the Timings track over the Main thread's flame chart, the GPU's work in the GPU track, and every frame in Frames. A frame that misses its vsync is red there; its span says whose it was.

DevTools in the window it measures costs that window a little. For a cleaner trace, start the app with a debugging port and record from Chrome instead: quit WattRoom, run `/Applications/WattRoom.app/Contents/MacOS/WattRoom --remote-debugging-port=9222` (Windows: `"%LOCALAPPDATA%\Programs\WattRoom\WattRoom.exe" --remote-debugging-port=9222`), open `chrome://inspect` in Chrome, add `localhost:9222` under Configure, and inspect the WattRoom page. Nothing in either way leaves the machine: a trace is a file you save, or don't.

## Running it

macOS only: it reads the Apple GPU driver's per-process accounting.

```bash
make dev-web
```

```bash
make perf
```

For the scenes, the Go server has to run too (`make infra` once, then `make dev-server`):

```bash
make perf-scenes
```

`make perf` opens a window over each display in turn, about a minute and a half per display. `make perf-scenes` takes about five minutes for three displays: it builds the crew once, then measures each scene on every display by moving the window. The report is printed and written to `$TMPDIR/wattroom-perf-*/report.md`, with every sample in `results.jsonl` beside it.

**Before a run, quit whatever redraws:** the WattRoom app itself, videos, browser tabs with animation, and the Claude app's browser pane. Then leave the machine alone. The report names every other process that used the GPU during its first baseline, so a noisy run shows as noisy.

Knobs, all optional:

| Variable | Default | What it does |
|---|---|---|
| `PERF_DISPLAYS` | all | Comma-separated display names or ids, matched as substrings: `benq,built-in` |
| `PERF_CASES` | the list in `desktop/perf/main.js` | Space-separated `case=…` specs, e.g. `"riding-bars&n=4 riding-bars&n=4&theme=light youtube"` |
| `PERF_SAMPLES` / `PERF_SAMPLE_MS` | 3 / 1000 | Samples per case and how long each lasts; the median is reported |
| `PERF_SETTLE_MS` | 1500 | Wait after a case loads before sampling starts |
| `PERF_PROBE` | off | `make perf-scenes` only: after each scene, sample it again with one CSS feature switched off at a time (animations, transitions, filters, shadows, the stage's video). Where the number falls is what the scene pays for; it found the ride screen's gliding watts number (#2998) |
| `PERF_OUT` | `$TMPDIR/wattroom-perf-<time>` | Where the report and the raw samples go |

## What runs

- **`/dev/perf?case=…`** (`web/src/routes/(app)/dev/perf/`): one element on a static, app-like backdrop that is the same in every case. The components are the real ones. Where the app draws a mark as inline markup, the class string is copied verbatim from the call site, which is named beside it.
- **The page skips the app shell and the dev layout.** The dev nav bar's backdrop blur would otherwise sit inside every measurement.
- **Dark theme by default.** `theme=light` measures the light one.
- **Screen share and camera cases** receive their tracks from `/dev/perf/send`. It runs in a hidden window, its own renderer, drawing on a CPU-backed canvas. So a share costs the measured page its decoding and drawing, never its encoding.
- **`desktop/perf/scenes.js`** signs in as *Perf Viewer*, the measured window, and founds or reuses the crew *Perf Bench* with an animated crew emoji. Three more riders run in `desktop/perf/crowd.js`, a second Electron process with offscreen windows at 5 fps, so their work lands neither in the viewer's numbers nor in WindowServer's. The rider riding uses the app's own simulated trainer. The talker's microphone is a WebAudio source that talks in bursts; every other microphone is silent. The share is a 1080p code screen at 6 fps. Each scene saves a screenshot next to the report, so every number can be checked against what was on screen.
- **`desktop/perf/main.js`** is an Electron script, the same Chromium the desktop shell ships. For each display it loads every case, with a baseline (`case=none`) at the start, after every fifth case and at the end.

## Reading the report

Each display's section starts with its resolution and refresh rate. Both multiply every per-frame cost, so a number means nothing without them.

| Column | What it is | How to read it |
|---|---|---|
| **GPU % (spread)** | GPU time of the page's GPU process as a share of wall time: the figure Activity Monitor calls "% GPU". The spread is max − min across the samples | Anything that stays above 0 is doing GPU work on every frame |
| **renderer CPU %** | The page's renderer processes, as % of one core | Script, style, layout and paint |
| **GPU-process CPU %** | The GPU process's CPU, as % of one core | Mostly the cost of producing frames at all |
| **main thread ms/s** | Milliseconds of main-thread work per second, from DevTools' `TaskDuration` | Above a few ms/s for a pure CSS animation means it runs on the main thread and repaints every frame instead of being composited |
| **WindowServer GPU Δ / CPU Δ** | WindowServer compared with the display's baseline median | Only meaningful when the baselines agree; otherwise they are marked `~`. The system compositor's share of every frame the window produces |
| **video** | Received resolution and frame rate | Proves the stream arrived, and at what rate |

**How closely it measures.** On a quiet machine, one-second samples scatter by about ±0.5% GPU; half a second is barely worse. CPU is coarser — `ps` counts in centiseconds, and WindowServer's CPU wanders by a few percent. Between runs the same case can move by a few points of GPU, because "% GPU" is busy time at whatever clock the GPU is running at. **Compare two variants inside one run**, not across runs.

Where a number came from matters as much as the number: 0% GPU on a video case is real. Decoded video goes to macOS as an overlay and never enters the page's GPU process.

## What a real screen costs

`make perf-scenes` on an M2 Max, September 2026, before the #2998 fixes. Page GPU is the viewer's GPU process; WindowServer is its change from the baseline.

| Scene | XG27ACS: 5K backing, 165 Hz | Built-in: 2×, 120 Hz | BenQ: 1×, 120 Hz |
|---|---|---|---|
| Lounge, 4 in voice | 0% GPU, WindowServer +0 | 0%, +0 | 0%, +0 |
| + 3 animated emoji statuses | 2.4%, +1.8 | 1.8%, +1.8 | 1.7%, +1.1 |
| + one rider riding | **25.7%, +9.1** | 19.8%, +7.7 | 18.6%, +7.6 |
| + one rider talking | 25.7%, +8.5 | 19.4%, +7.6 | 18.1%, +7.8 |
| + screen share on stage (6 fps) | 29.9%, +21.3 | 25.6%, +10.2 | 21.2%, +10.8 |
| + you ride (Training) | 46.4%, +16.5 | 45.5%, +10.2 | 31.8%, +7.5 |

**Reading this table:**

- **An idle lounge is free,** even with four people in voice. Its renderer's ~15% CPU is the voice call itself.
- **A crew member riding somewhere is the single largest step,** before you ride yourself. That is `RidingBars`: the page now redraws every frame, and each glowing copy is recomputed.
- **Talking adds nothing once something else keeps the page redrawing.** The pulse's cost is the redraw itself, and that is already being paid.
- **A share costs more here than on its own,** because the stage's blurred zoom bar is recomputed on every frame the page draws, not only on each of the share's 6.

## What it has taught so far

Measured on an M2 Max in September 2026 (#2998):

- **An element that moves forever makes the window redraw at the display's refresh rate:** 120 or 165 times a second, against 6 for a real screen share. That is cheap only when the compositor can reuse what it drew: animate `transform` or `opacity` on an element whose own content does not change.
- **On a quiet machine, the redraw itself shows up in WindowServer.** Any element that moves forever — even the roster's 11 px pulsing mic, 0% GPU in the page — costs WindowServer about +8–11% GPU and +26–55% of a CPU core, the most on the 5K/165 Hz surface. The page-side fixes below do not touch this.
- **Fewer frames is the only thing that shrinks that floor.** Chromium produces a frame only when a stepped animation changes step: the pulse with `steps(12)` cost WindowServer +1.1% GPU and +1.3% CPU instead of +10.8% and +55%, and the riding bars with the glow per bar plus `steps(12)` +4.3% and +10% instead of +11.3% and +43%. Whether the stepping shows is a design question; the numbers are not.
- **Never put a `filter` on an ancestor of something that moves.** The drop-shadow has to be recomputed on every frame. `RidingBars` and `Logo` with `live` did exactly this, and cost 7–32% GPU. The same glow on each moving element cost 0%, and looks the same.
- **Never loop a paint property.** Looping `background-position`, `box-shadow`, colours or sizes repaints the element on the main thread every frame. That was `skeleton`, at 7–12% GPU and about 60 ms/s of main-thread work. Moving a band with `transform` instead cost 0%, as `UpdateRow` already does.
- **Animate HTML, not SVG, when it loops.** An SVG `rect`'s transform animation composited on one display and not on the two others.
- **Video is cheap on the GPU and a YouTube embed is expensive on the CPU:** 19–29% of one core at the jukebox's size, 40–58% at stage size.
- **The display multiplies everything.** A HiDPI "looks like" mode renders at twice the panel's resolution and scales down, which makes it the most expensive configuration to animate on.

## A long ride in the world

`make world-soak` rides `/dev/world`'s 29 km synthetic loop for two simulated hours at 16× and judges every metric flat (docs/spec/world.md, "Soak"). Software GL (SwiftShader) on the dev VM, October 2026, 41.3 km a run; heap after a forced collection, MB (#3851):

| minute | km | before | after |
|---|---|---|---|
| 0 | 0.0 | 27.9 | 26.7 |
| 30 | 8.5 | 37.4 | 32.0 |
| 60 | 22.6 | 43.2 | 30.0 |
| 90 | 35.5 | 42.0 | 32.3 |
| 120 | 41.3 | 42.0 | 33.5 |
| last 30 over first 30 | | **+20 %** | +5 % |

- **Before, the heap followed road covered:** about 0.5 MB a kilometre, every ground chunk, settled tile and 40 m height point kept once made, so a point-to-point route paid for its whole length.
- **After, it follows the ground around the eye:** the ride lets go of tiles and chunks past the reach it draws, and the ground's height caches are a fixed 256 × 256 slots each.
- Geometries (20–21), programs, listeners (50), intervals (1) and the ground held (under its ~15.1k window) stayed flat in both. Frame times on SwiftShader are reported, never judged.

## The world on a real GPU

Pixel 3D, measured before it gave way to Diorama 3D on 2026-11-07 (`pixels=d` draws Diorama now): `make perf` with `PERF_CASES="world&pixels=1 world&pixels=0"`, `PERF_SETTLE_MS=15000` and `PERF_SAMPLES=5` draws `/dev/perf?case=world` in each 3D look, full screen. M2 Pro, November 2026, page GPU %:

| Display | Pixel 3D | Smooth |
|---|---|---|
| Built-in: 3024 × 1964 px at 2×, 120 Hz | 7.0 % | 7.2 % |
| Mi Monitor: 3440 × 1440 px at 1×, 144 Hz | 4.7 % | 9.1 % |

- **At 1×, Pixel 3D costs about half of Smooth.** Its scene is about 0.1 MP and draws without multisampling.
- **At 2×, the two cost the same.** Pixel 3D's pass and words draw at the device's own 5.9 MP, so every world pixel stays sharp. At the 1 MP budget it cost 5.2 %, and the browser's upscale blurred every edge.
- The Mi Monitor's numbers come from the run before that change, which leaves a 1× display as it was. The run after it read 0 % GPU and 105 % renderer CPU there: the window did not draw on the GPU, so it is not counted.
- `make perf-scenes` stops at its third scene, because the voice channel no longer has the Free ride control it presses. Its world scenes are not measured yet.

## A camera switch on a still world

A world whose rider stands still draws one frame a second when nothing in it moves (loop.ts; "A standing world" below), each moving the ride on a tenth of a second (scene.ts's `MAX_DT`). That is a voice channel's free ride before the first pedal stroke. The camera eased into each new shot on its follow's half-life, so a switch crawled at that rate (a rider, 2026-11-11: "really laggy"). Now a switch is a cut, as docs/spec/motion.md has it, drawn on the next animation frame. The world then draws on for at most 2 s while the ground and the dressing round the new eye come in.

Measured in a headless SwiftShader Chromium at 1440 × 900, 2026-11-11, with the camera button in a voice channel's free ride on the Pass loop before pedalling. Times are from the click until the world shows the new shot, and until the picture stops changing:

| Switch | before: first change / settled | after |
|---|---|---|
| Chase → Overhead | 27 ms / **11.1 s** | 39 ms / 39 ms |
| Overhead → Side | 695 ms / 695 ms | 38 ms / 38 ms |
| Side → Steady | 513 ms / 4.5 s | 35 ms / 4.8 s ¹ |
| Steady → Chase | 173 ms / **11.1 s** | 36 ms / 36 ms |

¹ The quality ladder stepping down a rung on SwiftShader (`data-rung` L2, `slow`), not the camera: the shot itself stands from the first frame.

The click's own script cost was never the problem: about 50–80 ms on that rig, one long animation frame, before and after.

## The world on the slow rig

`make world-bench` (needs `make dev-web`) is the low tier's rig without the hardware (#3082). It opens `/dev/perf?case=world` in headless Chromium on SwiftShader twice: once as it is, once with the page's CPU throttled 4× through DevTools. Each run warms up for 15 s and measures for 60 s. It prints the frame interval and the render's JS time (p50 and p95), the frames a second, the share of vsync-divisor intervals missed, and the draws and triangles, set against docs/spec/world.md's tiers and Fallback. The dev build's frame judge stands down for it, so the world keeps drawing past the Fallback and every miss is counted.

Knobs: `BENCH_VIEW` (default `1280x720`, the realism lab's; `960x540` is about the low tier's 0.5 MP), `BENCH_LOOK` (`diorama`, the app's default, or `smooth`), `BENCH_SECONDS` (60), `BENCH_WARMUP` (15), `BENCH_RATES` (`1 4`, the CPU throttles, one run each), `BENCH_DPR` (1; 2 is a Retina screen), `BENCH_GL` (`swiftshader`; `gpu` draws on this machine's own GPU, still headless, Metal on a Mac), `BENCH_PROFILE=1` (a CPU profile of 10 s of each run, its ten busiest functions printed).

`BENCH_SCENES` picks what is ridden, one run each: `world` (the default, `/dev/perf?case=world`), `ride` (`/ride` on the Pass loop, the simulated trainer riding), `voice` (the same ride from a crew's voice channel, in voice) and `voice-standing` (the voice channel's ride with no trainer, standing at the start). The app scenes load with `?perf` and print a second table from the overlay's handle: videos playing, the CPU of the browser's renderer and GPU processes, page frames, long tasks and the busiest `wattroom:` spans. `BENCH_CAMS=n` puts n crew-mates in the call with Chromium's fake camera on, each in its own context of the same browser.

**`make voice-bench`** (needs `make dev-server` too) is `BENCH_SCENES="ride voice voice-standing" BENCH_RATES=1`: the world in a voice channel set against `/ride` alone (#4533).

## The world in a voice channel

A rider, 2026-11-12 (#4533): in a voice channel, Ride with no trainer, the 3D world is "really buggy and slow"; /ride is smoother. `make voice-bench` on an M5 Pro, November 2026, 30 s after 15 s at 1280 × 720, Diorama 3D, the machine shared with two other agents:

| Scene | GPU: world fps, missed, frame p50 / p95 | Render JS p50 / p95 | Renderer / GPU-process CPU | Software (SwiftShader): world fps, frame p50 / p95 |
|---|---|---|---|---|
| `/ride`, simulated trainer | 30.1, 0 %, 33.3 / 34.2 ms | 1.4 / 2.0 ms | 11 % / 7 % | 4.5, 228 / 258 ms |
| voice channel in voice, simulated trainer | 30.1, 0 %, 33.3 / 34.1 ms | 1.7 / 2.1 ms | 20 % / 7 % | 4.4, 236 / 289 ms |
| voice channel in voice, no trainer | **1.0**, 0 %, 1000 / 1001 ms | 1.4 / 6.1 ms | 12 % / 1 % | 1.0, 1000 / 1001 ms |

On the GPU, both rides: no long tasks, page frames at 60 a second, 18–19 draws and 94k triangles. A 60 s run and one at 2× with two cameras in the call (`BENCH_DPR=2 BENCH_CAMS=2`, the canvas at its 1 MP budget) read the same: 30.1 fps, 0 % missed, render JS 1.6–2.8 ms p50.

- **Riding, the voice channel costs the world nothing measurable on a GPU.** Same frames, same misses, render JS within the run-to-run spread. Voice itself is about 9 % of a core more in the renderer (the call, its noise filter and the mic meter, off the main thread); `channel-message` is about 1 ms a second.
- **No video tile draws under the ride's 3D view.** With two cameras in the call, the lounge shows a 320 × 180 tile; the ride's 3D view has no video element at all.
- **The lounge is not drawn behind the world.** Switched to the Lounge view, `world-frame` stops and `lounge-frame` runs at 14 a second, 0.7 ms each.
- **With no trainer the world draws one frame a second.** Nothing moves, so loop.ts's idle clock holds it at `IDLE_MS`, as designed (#4528). `/ride` cannot start without a trainer or the simulated one, so there the world is always moving: the rider was comparing a still world against a moving one. Standing, each frame draws 27 draws against riding's 19, and its JS stays at 6–10 ms for the first ~40 s: the rider sprite sheets are drawn 3 ms a frame (rider-sprite.ts `drawSheets`), at one frame a second. What came of it: the next section.
- **On the software rig voice costs about 4–8 % of the frame rate,** reproduced in three runs (4.7 → 4.4, 4.7 → 4.3, 4.5 → 4.4 fps). SwiftShader rasterises on 8–10 cores of the GPU process, so the renderer's extra 8 % of a core competes with it. On a machine without a usable GPU, voice and the world share the CPU.

The throttle slows only the page's own thread. SwiftShader draws in the GPU process, at the speed of the machine's CPU, so its frame times are a software rig's and say nothing about a GPU. The results are in docs/spec/world.md, "The slow rig".

## A standing world

At a frame a second, a standing world was still only where nothing in it moved. The pass's rain and snow run on the wall clock, and so does a roadside person's wave: both jumped a second at a time, and the rider sprite's turns popped in a second apart as their sheets trickled up. That was the "buggy and slow" world (#4533). The rule now (loop.ts `Pace`, scene.ts `pace`):

- **Moving: 30 fps,** as before. A rider sheet still being drawn counts as moving, so the sheets finish in the first second or two instead of the first forty.
- **Standing, something moving by itself: 15 fps,** the lounge's own rate, which its rain and snow are drawn at. That is rain or snow in the pass, or someone who waves within sight, near enough that an art pixel is at least 0.45 screen pixels (about 85 m at 720 px high): farther, the sprite is its quarter copy and the arm no pixel of its own (roadside.ts `wavesInSight`).
- **Standing, nothing moving: a frame a second.** It cannot be seen. The lowest rung, which draws no weather, always stands here, and so does a world that missed more than a fifth of its 15 fps intervals three seconds in a row (loop.ts `ambientWatch`), for the rest of the ride.
- Rejected: 30 fps standing (12 % of a core in the GPU process against 15 fps's 7 %, for a picture that shows nothing more), freezing the rain and the waves while standing (frozen streaks over the road read as a broken picture, not a still one), and the cheapest rung while standing (the picture would sharpen with the first pedal stroke).

`make voice-bench`, M5 Pro, November 2026, headless at 1280 × 720, Diorama 3D, 30 s after 15 s, `main` and this change in one session on a machine shared with other jobs. Its JS is about twice the morning's run above, riding included: compare inside the table.

| Scene, GPU (Metal) | before: world fps, render JS p50 / p95, draws, renderer / GPU-process CPU, `world-frame` ms a second | after |
|---|---|---|
| `/ride`, simulated trainer | 30.2, 4.3 / 5.1 ms, 18, 24 % / 14 %, 120 | 30.2, 4.0 / 4.8 ms, 18, 22 % / 14 %, 114 |
| voice channel, simulated trainer | 30.1, 3.8 / 5.2 ms, 18, 35 % / 11 %, 114 | 30.1, 3.8 / 5.1 ms, 18, 35 % / 11 %, 112 |
| voice channel, no trainer, at the START arch with a waver in sight | **1.0**, 8.6 / 11.3 ms, 27, 26 % / 2 %, 7.6 | **15.1**, 4.2 / 4.9 ms, 23, 32 % / 7 %, 60 |
| the same, nothing in sight moving (pace held at still) | | 1.0, 4.5 / 5.3 ms, 23, 26 % / 2 %, 4.3 |

| Scene, software (SwiftShader) | before: world fps, renderer / GPU-process CPU | after |
|---|---|---|
| voice channel, simulated trainer | 4.7, 12 % / 1023 % | 4.8, 12 % / 1022 % |
| voice channel, no trainer | 1.0, 19 % / 131 % | 1.0, 18 % / 136 %: 7.0 fps and 865 % until `ambientWatch` stood it down |

- **Standing with something moving costs half of riding.** On the GPU, 15 fps is +5 % of a core in the GPU process and about +6 % in the renderer (the renderer moves a few points run to run); riding is +9 % and +9 %. A frame a second still holds whenever nothing on screen moves.
- **The sheets are done in the first two seconds.** Before, standing frames took 6–10 ms for the first ~40 s; after, the world draws at 30 fps while the sheets are drawn (19.5 frames a second over the first 2 s, the turn to 15 included), then 3.7–3.9 ms frames.
- **27 draws standing against 19 riding was the START arch.** A standing rider waits under it; a moving one has left it behind. Its banner was a box with a material a face, six draws; it is now two, its chrome and its painted faces (furniture.ts). The finish arch, a game's arch and a sprint banner are the same arch.
- **The always-on 50 ms clock was the climb card's, not the dock-in's.** `RidingSurface`'s dock-in clock runs only while a count-in does, and a voice channel's free ride has none. The climb card's moments queue (climb-cues.svelte.ts) ticked 20 times a second all ride: 403 ticks in 20 s standing. It now runs only while a moment is on: 53 ticks for the Pass loop's opening climb card, then none.
- **The page still sees 60 animation frames a second while the world stands,** the loop asking each vsync whether to draw (and `?perf`'s own counter). Waking on a timer instead is the next thing to measure, with the overlay off.

## Adding a case

Add its name to `KNOWN` in `+page@.svelte` and render the real component under it. Put it in `DEFAULT_CASES` in `desktop/perf/main.js` only if it earns the time: something that animates without end, or a media path people use while riding.
