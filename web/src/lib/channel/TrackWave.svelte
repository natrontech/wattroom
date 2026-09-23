<script lang="ts">
	import { trackPeaks } from '$lib/music/peaks';

	// A library track on the deck (#1425): YouTube's rules give a video a
	// ≥200 px tile; an MP3 inherited that seat and filled it with a glyph.
	// The seat draws the track's own waveform now, the played bars in the
	// live hue — the playhead is the one live thing in the column, which is
	// what ADR-0005 reserves the glow for. The same 104 × 34 box the pads use,
	// stretched to whatever seat holds it.
	let {
		trackId,
		progress = 0,
		bars = 56,
	}: {
		trackId: string;
		/** 0–1 along the track. */
		progress?: number;
		bars?: number;
	} = $props();

	const W = 104;
	const H = 34;

	let real = $state<number[] | null>(null);
	$effect(() => {
		const id = trackId;
		real = null;
		let live = true;
		void trackPeaks(id, bars).then((peaks) => {
			if (live && peaks) real = peaks;
		});
		return () => {
			live = false;
		};
	});

	// The track's own envelope once decoded, and nothing shaped like one
	// before that (#1509): a seat drawing a made-up silhouette for the first
	// seconds — or for good, when the file cannot be decoded here — was read
	// as the song's waveform being wrong. Until the peaks arrive the seat is
	// a hairline, which says "not read yet" and nothing else.
	const shape = $derived(
		(real ?? []).map((level, i, all) => {
			const h = Math.max(1, level * (H - 4));
			return {
				x: +((i * W) / all.length).toFixed(2),
				y: +((H - h) / 2).toFixed(2),
				h: +h.toFixed(2),
			};
		}),
	);
	const played = $derived(
		Math.floor(Math.min(1, Math.max(0, progress)) * bars),
	);
	const barWidth = $derived(+((W / bars) * 0.6).toFixed(2));
</script>

<svg
	viewBox="0 0 {W} {H}"
	width="100%"
	height="100%"
	preserveAspectRatio="none"
	aria-hidden="true"
	class="block"
>
	{#if !real}
		<rect
			x="0"
			y={(H - 0.3) / 2}
			width={W}
			height="0.3"
			fill="currentColor"
			class="text-neon/20"
		/>
	{/if}
	<g class="text-neon/40">
		{#each shape.slice(played) as bar, i (played + i)}
			<rect
				x={bar.x}
				y={bar.y}
				width={barWidth}
				height={bar.h}
				fill="currentColor"
			/>
		{/each}
	</g>
	<g class="text-watt glow-stroke">
		{#each shape.slice(0, played) as bar, i (i)}
			<rect
				x={bar.x}
				y={bar.y}
				width={barWidth}
				height={bar.h}
				fill="currentColor"
			/>
		{/each}
	</g>
</svg>
