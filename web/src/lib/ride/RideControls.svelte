<script lang="ts">
	/**
	 * Slot 1's control row on a ride alone (TARGETS ride-road-world 7): ⚑,
	 * the view switch, TV, +1 min and Skip block as 44 px icons, named and
	 * with tooltips; Change workout (#4257) and End ride in words. A road
	 * workout's blocks end at their metres (#3499), so it shows neither +1 min
	 * nor Skip (D13). With no workout there is nothing to skip or stretch, and
	 * Easier and Harder lead the row as a free ride's do (TARGETS
	 * ride-free-road 7, #4283).
	 */
	import AlarmClockPlus from '@lucide/svelte/icons/alarm-clock-plus';
	import MonitorUp from '@lucide/svelte/icons/monitor-up';
	import SkipForward from '@lucide/svelte/icons/skip-forward';
	import { confirm } from '$lib/confirm.svelte';
	import { createProfileStore } from '$lib/profile.svelte';
	import { EASIER_HARDER_OFF } from '$lib/ride/easier-harder';
	import FlagButton from '$lib/ride/FlagButton.svelte';
	import { gearsEnabled } from '$lib/ride/gears-enabled';
	import GearShift from '$lib/ride/GearShift.svelte';
	import type { RideShift } from '$lib/ride/ride-shift';
	import ViewSwitch from '$lib/world/ViewSwitch.svelte';
	import type { createWorldView } from '$lib/world/world-view.svelte';
	import type { createRideSession } from '$lib/workout/session.svelte';

	let {
		session,
		open,
		shift,
		world,
		drawn,
		countIn,
		onflag,
		ontv,
		onchange,
	}: {
		session: ReturnType<typeof createRideSession>;
		/** No workout, the road on (#4257). */
		open: boolean;
		/** The ride's one shifter, the keys' too (ride-shift.ts). */
		shift: RideShift;
		world: ReturnType<typeof createWorldView>;
		drawn: boolean;
		/** The count-in's way out: nothing runs yet, so the one control. */
		countIn?: { cancel: () => void };
		onflag?: () => void;
		ontv?: () => void;
		/** Opens Change workout; absent, no control. */
		onchange?: () => void;
	} = $props();

	const profile = createProfileStore();
	const last = $derived(
		session.info.segmentIndex + 1 >= session.segments.length,
	);

	// End sits in the cluster with TV and Skip block, 44 px each, and a ride
	// it ends cannot be resumed — one stray thumb filed a truncated ride
	// (#2623). It asks, the way a session's End always has (errors.md).
	async function endRide() {
		const ok = await confirm({
			title: 'End the ride?',
			body: 'The rest of the workout cannot be resumed. What you have ridden is saved if it is a minute or longer.',
			action: 'End the ride',
			cancel: 'Keep riding',
		});
		if (ok) session.stop();
	}

	/** A 44 px icon control mid-ride (ux.md), skinned as SessionControls' are. */
	const ICON = 'btn btn-secondary h-11 w-11 p-0 max-md:w-auto max-md:flex-1';
</script>

<div class="flex flex-wrap items-center gap-2">
	{#if countIn}
		<button onclick={countIn.cancel} class="btn btn-secondary btn-ride"
			>Cancel</button
		>
	{:else}
		{#if open && gearsEnabled()}
			<GearShift
				{shift}
				gear={session.gear}
				off={gearsEnabled('screen') ? null : EASIER_HARDER_OFF.gated}
				cassette={!profile.current.singleSpeed}
			/>
		{/if}
		{#if onflag}<FlagButton {onflag} sends="after" />{/if}
		{#if session.road}<ViewSwitch {world} {drawn} />{/if}
		{#if ontv}
			<button onclick={ontv} class={ICON} aria-label="TV mode" title="TV mode"
				><MonitorUp size={20} /></button
			>
		{/if}
		{#if !session.road?.pinned && !open}
			<button
				onclick={() => session.extend(60)}
				class={ICON}
				aria-label="One more minute"
				title="+1 min"><AlarmClockPlus size={20} /></button
			>
			<button
				onclick={() => session.skip()}
				disabled={last}
				class={ICON}
				aria-label="Skip block"
				title={last ? 'Last block — End ride instead' : 'Skip block'}
				><SkipForward size={20} /></button
			>
		{/if}
		{#if onchange}
			<button
				onclick={onchange}
				class="btn btn-secondary btn-ride max-md:flex-1">Change workout</button
			>
		{/if}
		<button
			onclick={endRide}
			class="btn btn-secondary btn-ride max-md:basis-full">End ride</button
		>
	{/if}
</div>
