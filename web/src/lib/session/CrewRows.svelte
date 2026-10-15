<script lang="ts">
	/**
	 * The crew beside the road (TARGETS ride-session-road 1, #3668): one 44 px
	 * row each at the riding floor's 24 px, yours tinted, and no number in
	 * watt — the 3 s power is G2's one figure. What more a row carries (gap,
	 * Category) is the peloton list's (#3107). Over the flat surface the crew
	 * keeps its camera strip (CrewStrip).
	 */
	import { useChannel } from '$lib/channel/context';
	import type { LiveRider } from '$lib/channel/types';
	import { contextMenu } from '$lib/context-menu.svelte';
	import { zoneOf } from '$lib/components/zones';
	import { wkg } from '$lib/format';
	import { crewMenu } from '$lib/session/crew-menu';

	let { riders }: { riders: LiveRider[] } = $props();
	const channel = useChannel();
</script>

<ul aria-label="the crew" class="flex w-60 flex-col">
	{#each riders as rider (rider.id)}
		<li
			{@attach contextMenu(() => crewMenu(channel, rider))}
			data-testid="crew-tile"
			class="flex min-h-11 items-center gap-3 rounded px-3 text-2xl leading-7 {rider.you
				? 'bg-neon/16'
				: ''}"
		>
			<span data-testid="crew-name" class="min-w-0 flex-1 truncate"
				>{rider.name}</span
			>
			{#if !rider.stale && rider.ftp > 0}
				<!-- The zone as a digit: ink, never colour alone (#3213, WCAG 1.4.1). -->
				<span data-testid="crew-zone" class="num text-muted shrink-0 text-xl"
					>Z{zoneOf(rider.watts, rider.ftp)}</span
				>
			{/if}
			<span class="num shrink-0 text-4xl leading-none"
				>{rider.stale ? '—' : wkg(rider.watts, rider.kg)}</span
			>
		</li>
	{/each}
</ul>
