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
	import { offsetWindow, pelotonRows } from '$lib/session/peloton-list';

	let {
		riders,
		offsets = {},
		followedId = null,
		onFollow,
	}: {
		riders: LiveRider[];
		/** Metres from the bunch by rider: the list's distance (#3215). */
		offsets?: Record<string, number>;
		/** The rider a phone follows (#4233): their row pressed, in neon. */
		followedId?: string | null;
		/** A phone's tap to follow, the whole row the target (ux.md). */
		onFollow?: (id: string) => void;
	} = $props();
	const channel = useChannel();

	// You and the 3 nearest while the bunch is steady, everyone while it moves.
	const steady = offsetWindow();
	let settled = $state(true);
	$effect(() => {
		settled = steady.settled(Date.now(), offsets);
	});
	const rows = $derived(pelotonRows(riders, offsets, settled));
	// Whose numbers the head shows: the followed rider's on a phone, else yours.
	const inHead = (rider: LiveRider) =>
		followedId ? rider.id === followedId : rider.you;
	const ROW = 'flex min-h-11 items-center gap-3 px-3 text-2xl leading-7';
</script>

{#snippet row(rider: LiveRider)}
	<span data-testid="crew-name" class="min-w-0 flex-1 truncate"
		>{rider.name}</span
	>
	{#if !rider.stale && rider.ftp > 0}
		<!-- The zone as a digit: ink, never colour alone (#3213, WCAG 1.4.1). -->
		<span data-testid="crew-zone" class="num text-muted shrink-0 text-2xl"
			>Z{zoneOf(rider.watts, rider.ftp)}</span
		>
	{/if}
	<!-- The head's rider's W/kg has one home, beside the 3 s power (D17):
	     their row keeps the place, unseen, so the zones stay one column. -->
	<span
		aria-hidden={inHead(rider)}
		class="num shrink-0 text-4xl leading-none {inHead(rider)
			? 'invisible'
			: ''}">{rider.stale ? '—' : wkg(rider.watts, rider.kg)}</span
	>
{/snippet}

<ul aria-label="the crew" class="flex w-max max-w-full min-w-60 flex-col">
	{#each rows as rider (rider.id)}
		{@const followed = rider.id === followedId}
		<li
			{@attach contextMenu(() => crewMenu(channel, rider))}
			data-testid="crew-tile"
			class="rounded {rider.you ? 'bg-neon/16' : ''} {followed
				? 'outline-neon outline-1'
				: ''}"
		>
			{#if onFollow}
				<button
					onclick={() => onFollow(rider.id)}
					aria-pressed={followed}
					title="follow {rider.name}"
					class="{ROW} w-full text-left">{@render row(rider)}</button
				>
			{:else}
				<div class={ROW}>{@render row(rider)}</div>
			{/if}
		</li>
	{/each}
</ul>
