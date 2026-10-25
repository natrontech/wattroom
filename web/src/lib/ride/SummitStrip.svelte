<script lang="ts">
	/**
	 * The summit strip (#3645, ADR-0079): a chip-high strip above the Skyline
	 * while the summit moment holds, "Summit · Climb II". Confetti falls from
	 * the strip at HC and I only (the budget, moments `confetti()`); Steady
	 * carries none (SPEC "Steady"), and reduced motion holds each piece still.
	 * The same strip calls your ghost's gap along the road (#3246): "Halfway ·
	 * Your best · 12 s ahead", the gap in neon as a model's output (G2).
	 */
	import { climbStage } from '$lib/ride/climb-cues.svelte';
	import { worldMode } from '$lib/world/mode';

	const PIECES = 14;
	const confetti = $derived(
		climbStage.summit?.confetti && worldMode() !== 'steady',
	);
</script>

{#if climbStage.summit}
	<div
		data-testid="summit-strip"
		role="status"
		class="summit-strip ride-panel relative flex items-center justify-center gap-3 px-4 py-2 text-2xl"
	>
		<span class="text-muted ride-label">Summit</span>
		<span
			class="border-neon bg-surface text-ink rounded border px-1 leading-none font-bold tracking-normal"
			>{climbStage.summit.cls}</span
		>
		{#if confetti}
			<span aria-hidden="true" class="pointer-events-none absolute inset-0">
				{#each Array.from({ length: PIECES }, (_, i) => i) as i (i)}
					<i
						class="confetti-piece {i % 2 ? 'bg-watt' : 'bg-neon'}"
						style="--c-x:{((i + 0.5) / PIECES) * 100}%;--c-i:{i}"
					></i>
				{/each}
			</span>
		{/if}
	</div>
{:else if climbStage.call}
	<div
		data-testid="call-strip"
		role="status"
		class="summit-strip ride-panel relative flex items-center justify-center gap-3 px-4 py-2 text-2xl"
	>
		<span class="text-muted ride-label">{climbStage.call.name}</span>
		<span class="text-neon">{climbStage.call.line}</span>
	</div>
{/if}
