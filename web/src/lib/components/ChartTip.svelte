<script lang="ts">
	// Hover tooltip for the SVG charts: a quiet raised box, clamped inside
	// the drawing. Coordinates are viewBox units of the caller.
	let {
		x,
		y,
		lines,
		maxX,
	}: { x: number; y: number; lines: string[]; maxX: number } = $props();

	const CHAR = 7.2; // ~13px font — generous estimate, not measured
	const PAD = 10;
	const LINE = 18;
	const w = $derived(Math.max(...lines.map((l) => l.length)) * CHAR + PAD * 2);
	const h = $derived(lines.length * LINE + PAD * 2 - 5);
	const left = $derived(Math.min(Math.max(x - w / 2, 0), maxX - w));
	const top = $derived(Math.max(y - h - 10, 0));
</script>

<g pointer-events="none">
	<rect
		x={left}
		y={top}
		width={w}
		height={h}
		rx="6"
		class="fill-surface-raised stroke-muted/40"
		stroke-width="1"
	/>
	{#each lines as line, i (i)}
		<text
			x={left + PAD}
			y={top + PAD + 8 + i * LINE}
			class="font-display text-[13px] {i === 0 ? 'fill-ink' : 'fill-muted'}"
			>{line}</text
		>
	{/each}
</g>
