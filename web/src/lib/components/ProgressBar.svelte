<script lang="ts">
	// One track, one fill. Height and fill color override per site
	// (`class="h-2"`, `fill="bg-z4"`); pct is clamped here so no caller
	// renders a 140% bar.
	let {
		pct,
		fill = 'bg-neon',
		class: cls = '',
	}: {
		pct: number;
		fill?: string;
		class?: string;
	} = $props();
</script>

<div class="bg-surface-raised h-1.5 overflow-hidden rounded-full {cls}">
	<div
		class="{fill} h-full rounded-full"
		style="width: {Math.min(100, Math.max(0, pct))}%"
	></div>
</div>
