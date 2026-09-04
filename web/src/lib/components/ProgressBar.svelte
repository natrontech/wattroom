<script lang="ts">
	// One track, one fill, clamped width — no caller renders a 140% bar.
	// Knobs REPLACE the defaults (no utility-vs-utility override races):
	// fill carries color + transition classes, h the height, track the bed.
	let {
		pct,
		fill = 'bg-neon',
		h = 'h-1.5',
		// The bar lives inside .panel, which IS bg-surface-raised — the old
		// default made the unfilled remainder invisible, so a quarter-full bar
		// read as a floating stub that disagreed with the level ring beside it
		// (#690). This is the ring's own track token (Avatar.svelte), so the two
		// shapes of one number now share a bed.
		track = 'bg-muted/20',
		class: cls = '',
		title,
	}: {
		pct: number;
		fill?: string;
		h?: string;
		track?: string;
		class?: string;
		title?: string;
	} = $props();
</script>

<div class="{track} {h} overflow-hidden rounded-full {cls}" {title}>
	<div
		class="{fill} h-full rounded-full"
		style="width: {Math.min(100, Math.max(0, pct))}%"
	></div>
</div>
