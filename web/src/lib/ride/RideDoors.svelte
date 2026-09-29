<script lang="ts">
	// The two doors (#3274): ride alone, or ride in your crew's lounge where
	// they can drop in. Equal, both huge — a rider who has a crew chooses each
	// time, from /ride and from Home. "Ride alone" stays one tap and never
	// broadcasts; the lounge opens the channel's free ride (ADR-0059) with the
	// mic off, and says once who sees your numbers there.
	//
	// It reads the crews' live read the sidebar keeps fresh (#2444), so who is
	// in the lounge now is the same answer the column beside it gives.
	import { goto } from '$app/navigation';
	import User from '@lucide/svelte/icons/user';
	import Users from '@lucide/svelte/icons/users';
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

	let { onAlone }: { onAlone: () => void } = $props();

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
	// The door taken last leads, so the usual choice is under the thumb.
	const loungeFirst = lastDoor() === 'lounge';

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

{#snippet aloneDoor()}
	<button
		onclick={alone}
		class="btn btn-secondary btn-lg w-full justify-center"
		data-testid="ride-alone"><User size={18} /> Ride alone</button
	>
{/snippet}

<section class="mx-auto w-full max-w-3xl" data-testid="ride-doors">
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
		{@render aloneDoor()}
		<p class="text-muted mt-2 text-xs">
			{crewLive.error}
			<button onclick={() => void crewLive.reload()} class="btn-link"
				>Retry</button
			>
		</p>
	{:else}
		{#snippet alonePanel()}
			<div>
				{@render aloneDoor()}
				<p class="text-muted mt-1.5 text-xs">Nobody sees this ride live.</p>
			</div>
		{/snippet}
		{#snippet loungePanel(name: string)}
			<div>
				<button
					onclick={intoLounge}
					class="btn btn-secondary btn-lg w-full justify-center"
					data-testid="ride-in-lounge"
					><Users size={18} /> Ride in {name}, your crew can drop in</button
				>
				<p class="text-muted mt-1.5 text-xs" data-testid="lounge-now">
					{#if others.length > 0}
						{others.map((o) => o.name).join(', ')}
						{others.length === 1 ? 'is' : 'are'} there now.
					{:else}
						Nobody is there yet — your crew hears you arrive.
					{/if}
					Your mic starts off.
				</p>
			</div>
		{/snippet}
		<!-- The door taken last leads, in reading order as well as on screen. -->
		<div class="grid gap-3 sm:grid-cols-2">
			{#if loungeFirst}
				{@render loungePanel(room.name)}
				{@render alonePanel()}
			{:else}
				{@render alonePanel()}
				{@render loungePanel(room.name)}
			{/if}
		</div>
		{#if withLounge.length > 1}
			<label class="text-muted mt-3 flex items-center gap-2 text-xs">
				Lounge of
				<select
					class="input input-xs w-auto"
					value={crew.id}
					onchange={(e) => pick(e.currentTarget.value)}
				>
					{#each withLounge as c (c.id)}
						<option value={c.id}>{c.name}</option>
					{/each}
				</select>
			</label>
		{/if}
		<!-- Said once, in the words every surface uses (#2824). -->
		<p class="text-muted-dim mt-3 text-[11px]">{liveNumbersLine}</p>
	{/if}
</section>
