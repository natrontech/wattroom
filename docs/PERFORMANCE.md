# Measuring what an element costs

A 6 px glow on three 11 px bars cost up to a third of an M2 Max GPU. On the same machine, a 1080p screen share cost under 2% (#2998). You can't work out what an element costs by reading its code; it has to be measured. `make perf` measures the app's real components, one at a time, on every display attached.

## Running it

macOS only: it reads the Apple GPU driver's per-process accounting.

```bash
make dev-web
```

```bash
make perf
```

`make perf` opens a window over each display in turn, about three minutes per display. The report is printed and written to `$TMPDIR/wattroom-perf-*/report.md`, with every sample in `results.jsonl` beside it.

**Before a run, quit whatever redraws:** the WattRoom app itself, videos, browser tabs with animation, and the Claude app's browser pane. Then leave the machine alone. The report names every other process that used the GPU during its first baseline, so a noisy run shows as noisy.

Knobs, all optional:

| Variable | Default | What it does |
|---|---|---|
| `PERF_DISPLAYS` | all | Comma-separated display names or ids, matched as substrings: `benq,built-in` |
| `PERF_CASES` | the list in `desktop/perf/main.js` | Space-separated `case=…` specs, e.g. `"riding-bars&n=4 riding-bars&n=4&theme=light youtube"` |
| `PERF_SAMPLES` / `PERF_SAMPLE_MS` | 3 / 2500 | Samples per case and how long each lasts; the median is reported |
| `PERF_SETTLE_MS` | 2500 | Wait after a case loads before sampling starts |
| `PERF_OUT` | `$TMPDIR/wattroom-perf-<time>` | Where the report and the raw samples go |

## What runs

- **`/dev/perf?case=…`** (`web/src/routes/(app)/dev/perf/`): one element on a static, app-like backdrop that is the same in every case. The components are the real ones. Where the app draws a mark as inline markup, the class string is copied verbatim from the call site, which is named beside it.
- **The page skips the app shell and the dev layout.** The dev nav bar's backdrop blur would otherwise sit inside every measurement.
- **Dark theme by default.** `theme=light` measures the light one.
- **Screen share and camera cases** receive their tracks from `/dev/perf/send`. It runs in a hidden window, its own renderer, drawing on a CPU-backed canvas. So a share costs the measured page its decoding and drawing, never its encoding.
- **`desktop/perf/main.js`** is an Electron script, the same Chromium the desktop shell ships. For each display it loads every case, with a baseline (`case=none`) at the start, after every fifth case and at the end.

## Reading the report

Each display's section starts with its resolution and refresh rate. Both multiply every per-frame cost, so a number means nothing without them.

| Column | What it is | How to read it |
|---|---|---|
| **GPU %** | GPU time of the page's GPU process as a share of wall time: the figure Activity Monitor calls "% GPU" | Anything that stays above 0 is doing GPU work on every frame |
| **renderer CPU %** | The page's renderer processes, as % of one core | Script, style, layout and paint |
| **GPU-process CPU %** | The GPU process's CPU, as % of one core | Mostly the cost of producing frames at all |
| **main thread ms/s** | Milliseconds of main-thread work per second, from DevTools' `TaskDuration` | Above a few ms/s for a pure CSS animation means it runs on the main thread and repaints every frame instead of being composited |
| **WindowServer GPU Δ / CPU Δ** | WindowServer compared with the display's baseline median | Only meaningful when the baselines agree; otherwise they are marked `~`. The system compositor's share of every frame the window produces |
| **video** | Received resolution and frame rate | Proves the stream arrived, and at what rate |

Where a number came from matters as much as the number: 0% GPU on a video case is real. Decoded video goes to macOS as an overlay and never enters the page's GPU process.

## What it has taught so far

Measured on an M2 Max in September 2026 (#2998):

- **An element that moves forever makes the window redraw at the display's refresh rate:** 120 or 165 times a second, against 6 for a real screen share. That is cheap only when the compositor can reuse what it drew: animate `transform` or `opacity` on an element whose own content does not change.
- **Never put a `filter` on an ancestor of something that moves.** The drop-shadow has to be recomputed on every frame. `RidingBars` and `Logo` with `live` did exactly this, and cost 7–32% GPU. The same glow on each moving element cost 0%, and looks the same.
- **Never loop a paint property.** Looping `background-position`, `box-shadow`, colours or sizes repaints the element on the main thread every frame. That was `skeleton`, at 7–12% GPU and about 60 ms/s of main-thread work. Moving a band with `transform` instead cost 0%, as `UpdateRow` already does.
- **Animate HTML, not SVG, when it loops.** An SVG `rect`'s transform animation composited on one display and not on the two others.
- **Video is cheap on the GPU and a YouTube embed is expensive on the CPU:** 19–29% of one core at the jukebox's size, 40–58% at stage size.
- **The display multiplies everything.** A HiDPI "looks like" mode renders at twice the panel's resolution and scales down, which makes it the most expensive configuration to animate on.

## Adding a case

Add its name to `KNOWN` in `+page@.svelte` and render the real component under it. Put it in `DEFAULT_CASES` in `desktop/perf/main.js` only if it earns the time: something that animates without end, or a media path people use while riding.
