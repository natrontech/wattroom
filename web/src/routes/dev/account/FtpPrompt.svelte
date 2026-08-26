<script lang="ts">
	let {
		current,
		suggested,
		best20,
	}: { current: number; suggested: number; best20: number } = $props();

	const gain = $derived(Math.round(((suggested - current) / current) * 100));
</script>

<!--
	docs/SPEC.md: prompt when 90-day 0.95 × best-20-min exceeds the set FTP by >2 %.
	Never auto-apply — FTP moves the difficulty of every workout you own.
-->
<div class="border-neon/40 bg-surface-raised rounded-lg border p-5">
	<p class="font-display font-bold">Your FTP looks low</p>
	<p class="text-muted mt-1.5 text-xs leading-relaxed">
		Your best 20 minutes in the last 90 days is {best20} W, which puts your FTP around
		<span class="text-white">{suggested} W</span> — {gain}% above the {current} W
		you have set. Raising it makes every workout harder, so it's your call.
	</p>
	<div class="mt-4 flex gap-2">
		<button
			class="rounded bg-white px-4 py-2 text-sm font-medium text-black hover:bg-white/90"
			>Set FTP to {suggested} W</button
		>
		<button
			class="border-muted/30 hover:border-muted/60 rounded border px-4 py-2 text-sm"
			>Keep {current} W</button
		>
	</div>
</div>
