<script lang="ts">
	// One track, one fill, clamped width — no caller renders a 140% bar.
	// Knobs REPLACE the defaults (no utility-vs-utility override races):
	// fill carries color + transition classes, h the height, track the bed.
	let {
		pct,
		fill = 'bg-neon',
		h = 'h-1.5',
		track = 'bg-surface-raised',
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
