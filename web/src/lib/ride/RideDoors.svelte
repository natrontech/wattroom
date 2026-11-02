<script lang="ts">
	// One Ride, and where beside it (Shell Rethink round 2, after Strava's
	// Start with its type chip): alone, or in a crew's lounge where it can drop
	// in. The place taken last is the default, so the usual ride is one tap.
	// Alone never broadcasts; the lounge opens the channel's free ride
	// (ADR-0059) with the mic off, and says once who sees your numbers there.
	//
	// It reads the crews' live read the sidebar keeps fresh (#2444), so who is
	// in the lounge now is the same answer the column beside it gives.
	import { goto } from '$app/navigation';
	import User from '@lucide/svelte/icons/user';
	import Bike from '@lucide/svelte/icons/bike';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { account } from '$lib/account.svelte';
	import { channelAddress } from '$lib/channel/address';
	import { askVoiceMuted } from '$lib/channel/voice-intent';
	import {
		lastDoor,
		lounge,
		loungeCrew,
		rememberCrew,
		rememberDoor,
	} from '$lib/crew-lounge';
	import { crewLive } from '$lib/nav/crew-live.svelte';
	import { liveNumbersLine } from '$lib/privacy-copy';

	let {
		onAlone,
		lead = false,
		class: cls = 'mx-auto w-full max-w-3xl',
	}: {
		onAlone: () => void;
		/** Fill the Ride button: off on Home while a session runs, where Join leads. */
		lead?: boolean;
		class?: string;
	} = $props();
	const skin = (first: boolean) =>
		lead && first ? 'btn-primary' : 'btn-secondary';

	if (!crewLive.loaded) void crewLive.reload();

	// The crews that have somewhere to ride, and the one this door is for:
	// picked here, else remembered, else the first.
	const withLounge = $derived(
		crewLive.crews.filter((c) => lounge(c, undefined)),
	);
	let picked = $state<string | null>(null);
	const crew = $derived(
		withLounge.find((c) => c.id === picked) ?? loungeCrew(crewLive.crews),
	);
	const room = $derived(crew ? lounge(crew) : undefined);
	const others = $derived(
		(room?.occupants ?? []).filter((o) => o.id !== account.me?.id),
	);
	// The place taken last is where the button goes.
	let where = $state<'alone' | 'lounge'>(
		lastDoor() === 'lounge' ? 'lounge' : 'alone',
	);
	function choose(value: string) {
		if (value === 'alone') where = 'alone';
		else {
			where = 'lounge';
			pick(value);
		}
	}
	const go = () => (where === 'alone' ? alone() : intoLounge());

	function alone() {
		rememberDoor('alone');
		onAlone();
	}

	function intoLounge() {
		if (!crew || !room) return;
		rememberDoor('lounge');
		const address = channelAddress(crew.id, room.id, room.name);
		askVoiceMuted(address.key, Date.now());
		void goto(address.training);
	}

	function pick(id: string) {
		picked = id;
		rememberCrew(id);
	}
</script>

{#snippet aloneDoor(first: boolean)}
	<button
		onclick={alone}
		class="btn {skin(first)} btn-lg w-full justify-center"
		data-testid="ride-alone"><User size={18} /> Ride alone</button
	>
{/snippet}

<section class={cls} data-testid="ride-doors">
	{#if !crewLive.loaded}
		<!-- Not a door that is missing while the read is out (#1666). -->
		<div class="grid gap-3 sm:grid-cols-2">
			<Skeleton class="h-11" />
			<Skeleton class="h-11" />
		</div>
	{:else if !crew || !room}
		<!-- A failed read with nothing to show: riding alone is still a tap,
		     and the lounge says why it is not here (errors.md). With no crew to
		     ride in at all, the parent shows no doors (doorsFor). -->
		{@render aloneDoor(true)}
		<p class="text-muted mt-2 text-xs">
			{crewLive.error}
			<button onclick={() => void crewLive.reload()} class="btn-link"
				>Retry</button
			>
		</p>
	{:else}
		<div class="flex flex-wrap items-stretch gap-2">
			<button
				onclick={go}
				class="btn {skin(true)} btn-lg min-w-0 flex-1 justify-center"
				data-testid="ride-start"
				><Bike size={18} />
				{where === 'alone' ? 'Ride alone' : `Ride in ${room.name}`}</button
			>
			<select
				aria-label="where to ride"
				class="input min-h-11 w-auto max-w-64"
				value={where === 'alone' ? 'alone' : crew.id}
				onchange={(e) => choose(e.currentTarget.value)}
			>
				<option value="alone">Alone</option>
				{#each withLounge as c (c.id)}
					<option value={c.id}>{c.name} · {lounge(c)?.name}</option>
				{/each}
			</select>
		</div>
		<p class="text-muted mt-1.5 text-xs text-pretty" data-testid="lounge-now">
			{#if where === 'alone'}
				A workout or a free ride, on your screen.
			{:else if others.length > 0}
				{others.map((o) => o.name).join(', ')}
				{others.length === 1 ? 'is' : 'are'} there now. Your mic starts off.
			{:else}
				Your crew hears you arrive and can drop in. Your mic starts off.
			{/if}
		</p>
		<!-- Said once, in the words every surface uses (#2824). -->
		{#if where === 'lounge'}
			<p class="text-muted-dim mt-1 text-[11px] text-pretty">
				{liveNumbersLine}
			</p>
		{/if}
	{/if}
</section>
