# Measuring what an element costs

A 6 px glow on three 11 px bars cost up to a third of an M2 Max GPU. On the same machine, a 1080p screen share cost under 2% (#2998). You can't work out what an element costs by reading its code; it has to be measured. Two commands do it, on every display attached:

- **`make perf`** measures the app's real components one at a time. It says which element costs what.
- **`make perf-scenes`** measures whole screens as a rider sees them. A crew's voice channel fills up step by step: people in voice, their statuses, someone riding, someone talking, a screen share, then your own ride. It says what a rider pays, and what a fix is worth in practice.

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

## Adding a case

Add its name to `KNOWN` in `+page@.svelte` and render the real component under it. Put it in `DEFAULT_CASES` in `desktop/perf/main.js` only if it earns the time: something that animates without end, or a media path people use while riding.
