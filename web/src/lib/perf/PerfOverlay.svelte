<script lang="ts">
	/**
	 * `?perf` (#4541): what the page spends, in a corner, for whoever is
	 * chasing a slow screen. Loaded only with the flag on, so a rider never
	 * pays for its observers or its own animation frame. Chrome, never live
	 * data: neon and muted, nothing glows. It takes no clicks; `?perf=0`
	 * puts it away.
	 *
	 * Its own cost, owned: an animation frame on every vsync (how it counts
	 * the page's frames) and a repaint of this box twice a second.
	 */
	import { onMount } from 'svelte';
	import { describeLongFrames, scriptName } from '#lib/world/long-frames.ts';
	import type { LongFrame } from '#lib/world/long-frames.ts';
	import { liveWorlds, perfStats } from './trace';
	import {
		type PerfSummary,
		type VideoReading,
		type VideoSummary,
		videoDelta,
	} from './stats';

	type WorldLine = {
		fps: number;
		missed: number;
		draws: number;
		triangles: number;
		textures: number;
		geometries: number;
		programs: number;
		pixelRatio: number;
		rung: number;
	};

	let summary = $state<PerfSummary | null>(null);
	let world = $state<WorldLine | null>(null);
	let video = $state<VideoSummary | null>(null);
	let held = $state('');

	onMount(() => {
		const stats = perfStats;
		if (!stats) return;
		let raf = requestAnimationFrame(function frame(now) {
			stats.frame(now);
			raf = requestAnimationFrame(frame);
		});

		const observers: PerformanceObserver[] = [];
		const supported = PerformanceObserver.supportedEntryTypes ?? [];
		if (supported.includes('longtask')) {
			const o = new PerformanceObserver((list) => {
				for (const e of list.getEntries())
					stats.longTask(e.duration, e.startTime + e.duration);
			});
			o.observe({ type: 'longtask' });
			observers.push(o);
		}
		// Which script held the longest frames: the Long Animation Frames timing names it (Chromium 123+).
		let frames: LongFrame[] = [];
		if (supported.includes('long-animation-frame')) {
			const o = new PerformanceObserver((list) => {
				for (const e of list.getEntries()) {
					const scripts = (
						e as PerformanceEntry & {
							scripts?: Parameters<typeof scriptName>[0][];
						}
					).scripts;
					const longest = scripts?.length
						? scripts.reduce((a, b) => (b.duration > a.duration ? b : a))
						: null;
					frames.push({
						at: e.startTime,
						ms: e.duration,
						what: longest ? scriptName(longest) : 'rendering',
					});
				}
			});
			o.observe({ type: 'long-animation-frame' });
			observers.push(o);
		}

		// The worlds' counters and the videos' decoded frames, read a second apart.
		let worldBefore = new Map<object, { rendered: number; missed: number }>();
		let videoBefore = new Map<HTMLVideoElement, VideoReading>();
		let readAt = performance.now();
		function readSecond() {
			const now = performance.now();
			const seconds = (now - readAt) / 1000;
			readAt = now;
			const worlds = liveWorlds();
			const w = worlds.at(-1);
			if (w) {
				const s = w.stats();
				const b = worldBefore.get(w) ?? s;
				const r = w.renderer();
				const drawn = s.rendered - b.rendered;
				const missed = s.missed - b.missed;
				world = {
					fps: seconds > 0 ? drawn / seconds : 0,
					missed: drawn + missed > 0 ? missed / (drawn + missed) : 0,
					...r,
					rung: w.rung(),
				};
				worldBefore = new Map([[w, s]]);
			} else world = null;
			const after = new Map<HTMLVideoElement, VideoReading>();
			for (const v of document.querySelectorAll('video')) {
				const q = v.getVideoPlaybackQuality();
				after.set(v, {
					width: v.videoWidth,
					height: v.videoHeight,
					frames: q.totalVideoFrames,
					dropped: q.droppedVideoFrames,
				});
			}
			video = videoDelta(videoBefore, after, seconds);
			videoBefore = after;
			const since = now - 10_000;
			frames = frames.filter((f) => f.at >= since);
			held = frames.length ? describeLongFrames(frames, 2) : '';
		}
		const second = setInterval(readSecond, 1000);
		const show = setInterval(
			() => (summary = stats.summary(performance.now())),
			500,
		);
		return () => {
			cancelAnimationFrame(raf);
			clearInterval(second);
			clearInterval(show);
			for (const o of observers) o.disconnect();
		};
	});

	const ms = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '–');
	const k = (x: number) =>
		x >= 1000 ? `${Math.round(x / 1000)}k` : String(Math.round(x));
</script>

<!-- Bottom right, over the now bar's height and under no click: the watts are top left, the ride's controls and setup on the right column and in the now bar. -->
<div
	class="border-neon/40 bg-surface/85 text-muted font-display pointer-events-none fixed right-2 bottom-20 z-[9999] w-72 rounded border px-2 py-1.5 text-[10px] leading-snug tabular-nums shadow-lg"
	aria-hidden="true"
	data-perf-overlay
>
	<div class="text-neon flex justify-between font-bold">
		<span>perf</span><span>?perf=0 hides</span>
	</div>
	{#if summary}
		<div>
			<span class="text-ink">page</span>
			{summary.fps.toFixed(0)} fps · frame {ms(summary.frame.p50)} / {ms(
				summary.frame.p95,
			)} ms p50/p95 · max {ms(summary.frame.max)}
		</div>
		<div>
			<span class="text-ink">long tasks</span>
			{summary.longTasks.count} in {(summary.windowMs / 1000).toFixed(0)} s · {Math.round(
				summary.longTasks.ms,
			)} ms · max {Math.round(summary.longTasks.max)}
		</div>
	{/if}
	{#if world}
		<div>
			<span class="text-ink">world</span>
			{world.fps.toFixed(0)} fps · missed {Math.round(world.missed * 100)} % · L{world.rung}
			· ×{world.pixelRatio.toFixed(2)}
		</div>
		<div>
			{world.draws} draws · {k(world.triangles)} tris · {world.textures} tex · {world.geometries}
			geo · {world.programs} prog
		</div>
	{/if}
	{#if video && video.playing > 0}
		<div>
			<span class="text-ink">video</span>
			{video.playing} playing · {video.fps.toFixed(0)} fps decoded · {video.dropped.toFixed(
				0,
			)} dropped/s · {video.mp.toFixed(2)} MP
		</div>
	{/if}
	{#if summary && summary.spans.length}
		<table class="mt-1 w-full">
			<thead>
				<tr class="text-neon text-left">
					<th class="font-normal">wattroom:</th>
					<th class="text-right font-normal">/s</th>
					<th class="text-right font-normal">p50</th>
					<th class="text-right font-normal">p95</th>
					<th class="text-right font-normal">ms/s</th>
				</tr>
			</thead>
			<tbody>
				{#each summary.spans as s (s.name)}
					<tr>
						<td class="text-ink">{s.name}</td>
						<td class="text-right">{s.rate.toFixed(0)}</td>
						<td class="text-right">{ms(s.p50)}</td>
						<td class="text-right">{ms(s.p95)}</td>
						<td class="text-right">{ms(s.perSecond)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
	{#if held}
		<div class="mt-1 truncate" title={held}>held: {held}</div>
	{/if}
</div>
