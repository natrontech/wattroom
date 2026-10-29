<script lang="ts">
	/**
	 * A free ride alone on a road (#3027): the channel's free ride surface,
	 * lifted to /ride for parity (ADR-0046). Ride from the first stroke, End
	 * ride saves against the route. No count-in, no workout: the road sets the
	 * grade, or the watts in watts mode. Your own road is set up on /ride's
	 * card, which hands the trainer over (#3855); only a crew's planned road
	 * pairs here. The ride is `theRide`'s (ADR-0093): leaving this screen
	 * never ends it, and this view only reads it.
	 */
	import RidePictures from '$lib/ride/RidePictures.svelte';
	import Banner from '$lib/components/Banner.svelte';
	import { canSimulate } from '$lib/ble/can-simulate';
	import { FtmsTrainer } from '$lib/ble/ftms';
	import { SimulatedTrainer } from '$lib/ble/simulated';
	import { channelConnection } from '$lib/channel/connection.svelte';
	import { formatClock, formatKm } from '$lib/format';
	import { createProfileStore } from '$lib/profile.svelte';
	import { freeRideLabel } from '$lib/ride/free-ride.svelte';
	import FreeRiding from '$lib/ride/FreeRiding.svelte';
	import FreeRideTv from '$lib/ride/FreeRideTv.svelte';
	import { gearsEnabled } from '$lib/ride/gears-enabled';
	import { bindShifters } from '$lib/ride/keys';
	import { carriesOn } from '$lib/ride/road-end';
	import SessionSummary from '$lib/ride/SessionSummary.svelte';
	import RideFlags from '$lib/ride/RideFlags.svelte';
	import type { RideableRoute } from '$lib/ride/roads';
	import { soloTrainer } from '$lib/ride/solo-trainer.svelte';
	import { theRide } from '$lib/ride/the-ride.svelte';
	import SensorOverview from '$lib/session/SensorOverview.svelte';
	import { heldTrainer } from '$lib/session/sensor-status';

	let {
		route,
		from = 0,
		doneHref = '/home',
	}: {
		/** The road this ride rides, or, before Start, the one it will. */
		route: RideableRoute;
		from?: number;
		/** Where Done goes. */
		doneHref?: string;
	} = $props();

	const profile = createProfileStore();
	// The ride, once Start made it: its road, recording, ghost and trainer.
	const ride = $derived(theRide.road);
	const trainers = soloTrainer();
	const held = $derived(heldTrainer(trainers, channelConnection.current?.ride));
	const flags = theRide.flags;
	let tv = $state(false);

	// Easier / Harder from the keys and any clicker, wherever the pair and its
	// hint are drawn (#3329, #3661).
	$effect(() =>
		ride && ride.free.mode === 'grade' && gearsEnabled()
			? bindShifters(ride.solo.shift)
			: undefined,
	);

	function start() {
		const trainer = trainers.handOff();
		if (trainer) theRide.beginRoad(trainer, route, from);
	}
	function end() {
		tv = false;
		void ride?.end();
	}

	// You, in the shape the TV renders (#1632): a roster of one.
	const tvRider = $derived({
		id: 'you',
		name: 'You',
		ftp: profile.current.ftp,
		kg: profile.current.kg,
		you: true,
		coach: false,
		cameraOn: false,
		muted: false,
		speaking: false,
		hue: 0,
		watts: ride?.watts ?? 0,
		cadence: ride?.solo.metrics?.cadence ?? 0,
		hr: ride?.solo.metrics?.heartRate ?? 0,
		stale: ride?.stale ?? false,
		target: ride?.free.targetWatts ?? 0,
		trace: [],
	});
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (tv = false)} />

{#if ride?.ended && ride.free.outcome && !('short' in ride.free.outcome)}
	{@const outcome = ride.free.outcome}
	{@const free = ride.free}
	{@const ghost = ride.ghost}
	<!-- The road ends on the closing card (#3686, #3839): the frame every ride
	     closes on. The road's own section is #3141's. -->
	<SessionSummary
		kind="Free ride"
		title={route.name}
		titleHref={route.borrowed ? undefined : `/workouts/routes/${route.id}`}
		samples={free.ridden}
		ftp={profile.current.ftp}
		unsaved={'failure' in outcome}
		savedXp={'saved' in outcome ? outcome.saved.xp : undefined}
	>
		{#snippet actions()}
			{#if free.road && carriesOn(free.road)}
				<!-- Partway up your own road, the offer is this card's (#3205, TARGETS
				     ride-road-end 2): the same road from where you stopped. -->
				<a
					href="/ride?road={route.id}&from={Math.round(free.road.m)}"
					class="btn btn-secondary"
					>Carry on from km {formatKm(free.road.m)} next time</a
				>
			{/if}
			{#if 'saved' in outcome}
				<a href="/history/{outcome.saved.id}" class="btn btn-secondary"
					>See your ride</a
				>
			{/if}
			<RidePictures
				rideId={'saved' in outcome ? outcome.saved.id : undefined}
			/>
			<a href={doneHref} class="btn btn-primary">Done</a>
		{/snippet}
		{#snippet status()}
			{#if ghost.newBest}
				<!-- Your best beaten, end to end (#3246): a record, so the neon ramp (G2). -->
				<p
					data-testid="new-best"
					class="font-display text-neon text-lg font-bold"
				>
					{ghost.newBest}
				</p>
			{/if}
			{#if 'failure' in outcome}
				<Banner tone="error">
					It did not save — {outcome.failure.message} It is kept on this device, and
					Ride offers it again.
				</Banner>
			{/if}
		{/snippet}
	</SessionSummary>
{:else if ride?.solo.trainer}
	{@const free = ride.free}
	{@const solo = ride.solo}
	<!-- The riding surface (ADR-0046, #3669): the road free ride rides what a
	     workout on a road rides, world and all. The page's gutters are undone
	     where the world fills the frame, as RidingScreen does. -->
	<FreeRiding
		{free}
		watts={ride.watts}
		cadence={solo.metrics?.cadence ?? 0}
		hr={solo.metrics?.heartRate ?? 0}
		kg={profile.current.kg}
		lthr={profile.current.lthr}
		ftp={profile.current.ftp}
		stale={ride.stale}
		gear={gearsEnabled() ? solo.gear : undefined}
		shift={solo.shift}
		cassette={!profile.current.singleSpeed}
		ghost={ride.ghost}
		onend={end}
		onrepair={(next) => solo.repair(next)}
		onflag={() => flags.recorder.flag()}
		ontv={() => (tv = true)}
		worldClass="-mx-4 -my-5 sm:-mx-6"
	/>
	{#if tv}
		<FreeRideTv
			{free}
			rider={tvRider}
			ftp={profile.current.ftp}
			placeName={freeRideLabel(route)}
			onExit={() => (tv = false)}
		/>
	{/if}
{:else}
	<div class="m-auto flex w-full max-w-2xl flex-col gap-6">
		<header class="flex flex-wrap items-center gap-3">
			<p class="eyebrow">free ride</p>
			<h1 class="page-title-sm min-w-0 truncate">
				<!-- Ridden, the road opens its page (F1); a crew's road has none of yours. -->
				{#if ride?.ended && !route.borrowed}
					<a
						href="/workouts/routes/{route.id}"
						class="underline decoration-1 underline-offset-4">{route.name}</a
					>
				{:else}
					{route.name}
				{/if}
			</h1>
			<span class="font-display ml-auto text-2xl font-bold tabular-nums"
				>{formatClock(ride?.free.seconds ?? 0)}</span
			>
		</header>

		{#if !ride?.ended}
			<SensorOverview
				trainer={{
					state: held.state,
					device: held.device,
					reading: held.reading,
					hint: held.hint,
					error: held.error,
					onPair: () => void trainers.pair(new FtmsTrainer()),
					onForget: held.forget,
					onSimulate: canSimulate()
						? () =>
								void trainers.pair(
									new SimulatedTrainer({
										baseWatts: profile.current.ftp * 0.8,
									}),
								)
						: undefined,
				}}
			/>
			<button
				onclick={start}
				disabled={!held.paired || held.fault === 'reconnecting'}
				class="btn btn-primary btn-lg">Start riding</button
			>
			{#if !held.paired}
				<p class="text-muted text-sm">
					Pair your trainer above to start — the road needs something to set its
					slope.
				</p>
			{:else if held.fault === 'reconnecting'}
				<p class="text-muted text-sm">Waiting for the trainer to come back.</p>
			{/if}
			{#if route.borrowed}
				<p class="text-muted text-sm">
					The crew’s road, from where the session starts. It saves as a free
					ride.
				</p>
			{/if}
		{:else if ride?.free.saving}
			<p class="text-muted text-sm" role="status">Saving your ride…</p>
		{:else}
			<p class="text-muted text-sm" role="status">
				Under a minute — nothing to save.
			</p>
		{/if}
		{#if ride?.ended}
			<!-- The flags the ride raised, sent with their notes (#52). -->
			<RideFlags {flags} />
		{/if}
	</div>
{/if}
