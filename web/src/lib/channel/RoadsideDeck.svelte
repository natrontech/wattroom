<script lang="ts">
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import Bell from '@lucide/svelte/icons/bell';
	import GlassWater from '@lucide/svelte/icons/glass-water';
	import Heart from '@lucide/svelte/icons/heart';
	import CheerDeck from '$lib/channel/CheerDeck.svelte';
	import { channelConnection } from '$lib/channel/connection.svelte';
	import { useChannel } from '$lib/channel/context';
	import { account } from '$lib/account.svelte';
	import type { RoadsideStamp } from '$lib/protocol';
	import { climbsOf } from '$lib/road/climbs';
	import { nextChalkSpot, STAMPS } from '$lib/roadside';

	// The roadside's deck (#3022, ADR-0064): the cheers and the cowbell, a
	// bottle for the rider you are watching, and chalk for the next climb
	// (#3029). Paint, sound and information — nothing on it reaches anybody's
	// trainer. The bottle waits on their screen for an easy block, so handing
	// one up mid-interval costs them nothing (roadside.ts).
	let {
		to,
	}: {
		/** Who the bottle goes to — the rider being watched; none, no bottle. */
		to: { id: string; name: string } | null;
	} = $props();

	const live = $derived(channelConnection.current?.live);
	const channel = useChannel();
	const road = $derived(channel.ridden?.road);
	const climbs = $derived(road ? climbsOf(road) : []);
	// The next climb ahead you have not chalked: where every stamp goes.
	const spot = $derived.by(() => {
		const tick = live?.tick;
		const world = tick?.world;
		if (!road || !world) return null;
		const mine = (tick.roadside?.paint ?? []).filter(
			(p) => p.riderId === account.me?.id,
		);
		return nextChalkSpot(
			climbs,
			road.length,
			!!tick.state.route?.loop,
			world.bunchM + (world.lap ?? 0) * road.length,
			mine,
		);
	});

	const WORDS: Partial<Record<RoadsideStamp, string>> = {
		allez: 'Allez',
		hopp: 'Hopp',
	};
</script>

<div class="grid gap-2">
	<CheerDeck onCheer={(key) => live?.cheer(key)} />
	{#if to && live}
		<button
			onclick={() => live.bottle(to.id)}
			class="btn btn-secondary btn-lg w-full"
			><GlassWater size={16} /> Hand {to.name} a bottle</button
		>
	{/if}
	{#if live && road}
		<!-- Words at the riding floor (TARGETS G4): a rider a game put out
		     chalks from here on the bike. -->
		<p class="text-muted text-2xl">Chalk the next climb</p>
		<div
			role="group"
			class="grid grid-cols-6 gap-1.5"
			aria-label="chalk the next climb"
		>
			{#each STAMPS as stamp (stamp)}
				{@const initial = stamp === 'initial'}
				<button
					disabled={!spot || (initial && !to)}
					onclick={() =>
						spot && live.paint(stamp, spot, initial ? to?.id : undefined)}
					aria-label={initial
						? `Chalk ${to?.name ?? 'a rider'}'s initial`
						: `Chalk ${WORDS[stamp] ?? stamp}`}
					class="border-muted/20 hover:border-muted/50 flex min-h-11 items-center justify-center rounded border text-2xl font-bold disabled:opacity-40"
				>
					{#if stamp === 'arrow'}<ArrowUp size={26} />
					{:else if stamp === 'heart'}<Heart size={26} />
					{:else if stamp === 'cowbell'}<Bell size={26} />
					{:else if initial}{to?.name.slice(0, 1).toUpperCase() ?? '—'}
					{:else}{WORDS[stamp]}{/if}
				</button>
			{/each}
		</div>
		<!-- One line, one voice: the answer to the last tap first, else why
		     the stamps are off. -->
		{#if live.roadsideRefusal || !spot}
			<p role="status" class="text-2xl">
				{live.roadsideRefusal ?? 'No climb left ahead to chalk.'}
			</p>
		{/if}
	{/if}
</div>
