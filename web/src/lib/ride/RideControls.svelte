<script lang="ts">
	/**
	 * Slot 1's control row on a ride alone (TARGETS ride-road-world 7): ⚑,
	 * the view switch, then the ride's icon controls from the list the phone
	 * remote draws too (ride-controls.ts): Camera and Photo on a road, TV,
	 * Pause, +1 min and Skip block; Change workout (#4257) and End ride in
	 * words. A road workout's blocks end at their metres (#3499), so it shows
	 * neither +1 min nor Skip (D13). With no workout there is nothing to skip
	 * or stretch, and Easier and Harder lead the row as a free ride's do
	 * (TARGETS ride-free-road 7, #4283).
	 */
	import { createProfileStore } from '$lib/profile.svelte';
	import { EASIER_HARDER_OFF } from '$lib/ride/easier-harder';
	import { askToEndWorkout } from '$lib/ride/end-ride';
	import FlagButton from '$lib/ride/FlagButton.svelte';
	import BiasTrim from '$lib/session/BiasTrim.svelte';
	import { gearsEnabled } from '$lib/ride/gears-enabled';
	import GearShift from '$lib/ride/GearShift.svelte';
	import ModeSwitch from '$lib/ride/ModeSwitch.svelte';
	import type { RideShift } from '$lib/ride/ride-shift';
	import RideControlButton from '$lib/ride/RideControlButton.svelte';
	import { NEEDS_3D } from '$lib/ride/ride-controls';
	import { rideOffers } from '$lib/ride/ride-offers.svelte';
	import ViewSwitch from '$lib/world/ViewSwitch.svelte';
	import type { createWorldView } from '$lib/world/world-view.svelte';
	import { askCamera, askPhoto } from '$lib/world/ride-view';
	import type { createRideSession } from '$lib/workout/session.svelte';
	import { EXTEND_SECONDS, LAST_BLOCK, pauseOf } from '$lib/ride/remote-blocks';

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
	// Pause, as the phone's (#3217): a ride alone, once the count-in is over.
	const clock = $derived(pauseOf(session));

	// End sits in the cluster with TV and Skip block, 44 px each, and a ride
	// it ends cannot be resumed — one stray thumb filed a truncated ride
	// (#2623). It asks, the way a session's End always has (errors.md). The
	// phone's End asks on the phone, so it ends at once here.
	async function endRide() {
		if (await askToEndWorkout()) session.stop();
	}
	$effect(() =>
		countIn ? undefined : rideOffers.offer('end', () => session.stop()),
	);
</script>

<div class="contents">
	{#if countIn}
		<button onclick={countIn.cancel} class="btn btn-secondary btn-ride"
			>Cancel</button
		>
	{:else}
		{#if open}
			<!-- The free ride's switch (#4283): Road by its grade, or Watts by it. -->
			<ModeSwitch mode={session.drive} road onmode={session.setDrive} />
		{/if}
		{#if open && gearsEnabled() && session.drive !== 'watts'}
			<GearShift
				{shift}
				gear={session.gear}
				off={gearsEnabled('screen') ? null : EASIER_HARDER_OFF.gated}
				cassette={!profile.current.singleSpeed}
			/>
		{/if}
		{#if !open}
			<!-- Easier and Harder, in the bar since the rail holds only numbers. -->
			<BiasTrim
				bias={session.bias}
				onBias={(step) => session.nudgeBias(step)}
			/>
		{/if}
		<!-- A phone's bar keeps the trim, Skip and End in view. -->
		{#if onflag}<span class="contents max-md:hidden"
				><FlagButton {onflag} sends="after" /></span
			>{/if}
		<ViewSwitch {world} {drawn} road={!!session.road} />
		{#if session.road}
			<RideControlButton
				control="camera"
				onclick={() => askCamera()}
				disabled={!drawn}
				hint={NEEDS_3D}
				class="max-md:hidden"
			/>
			<RideControlButton
				control="photo"
				onclick={() => askPhoto()}
				disabled={!drawn}
				hint={NEEDS_3D}
				class="max-md:hidden"
			/>
		{/if}
		{#if ontv}
			<!-- A phone has no TV to send to, and its bar keeps End in view. -->
			<RideControlButton
				control="tv"
				onclick={ontv}
				offer="tv"
				class="max-md:hidden"
			/>
		{/if}
		{#if clock.pausable}
			<RideControlButton
				control={clock.paused ? 'resume' : 'pause'}
				onclick={() => (clock.paused ? session.resume() : session.pause())}
				pressed={clock.paused}
				class="max-md:hidden"
			/>
		{/if}
		{#if !session.road?.pinned && !open}
			<RideControlButton
				control="extend"
				onclick={() => session.extend(EXTEND_SECONDS)}
				class="max-md:hidden"
			/>
			<RideControlButton
				control="skip"
				onclick={() => session.skip()}
				disabled={last}
				hint={LAST_BLOCK}
			/>
		{/if}
		{#if onchange}
			<button
				onclick={onchange}
				class="btn btn-secondary btn-ride whitespace-nowrap max-md:hidden"
				>Change workout</button
			>
		{/if}
		<button
			onclick={endRide}
			class="btn btn-secondary btn-ride whitespace-nowrap">End ride</button
		>
	{/if}
</div>
