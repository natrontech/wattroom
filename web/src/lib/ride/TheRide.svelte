<script lang="ts">
	/**
	 * The app's ride alone, drawn (ADR-0093): a workout's riding screen, its
	 * TV and its summary, the ramp test, or a free ride on a road, wherever
	 * the rider opens it. /ride and /ramp draw it, and so does a voice
	 * channel's Training page while it runs. The ride is `theRide`'s;
	 * this view only reads it.
	 */
	import { onDestroy } from 'svelte';
	import { apiBlob } from '$lib/api';
	import Banner from '$lib/components/Banner.svelte';
	import { createProfileStore } from '$lib/profile.svelte';
	import { downloadRideCard } from '$lib/ride/card';
	import { climbView } from '$lib/ride/climb-view';
	import { mapView } from '$lib/ride/map-view';
	import RampRiding from '$lib/ride/RampRiding.svelte';
	import RideFlags from '$lib/ride/RideFlags.svelte';
	import RideStatus from '$lib/ride/RideStatus.svelte';
	import RidingScreen from '$lib/ride/RidingScreen.svelte';
	import RoadRiding from '$lib/ride/RoadRiding.svelte';
	import SessionSummary from '$lib/ride/SessionSummary.svelte';
	import { theRide } from '$lib/ride/the-ride.svelte';
	import WorldPicture from '$lib/ride/WorldPicture.svelte';
	import TvOverlay from '$lib/session/TvOverlay.svelte';
	import { shareFile } from '$lib/share';
	import { describeBlock } from '$lib/workout/block';
	import { customWorkouts } from '$lib/workout/custom.svelte';
	import { skylineOf } from '$lib/workout/road-workout';
	import { isOpenRoad } from '$lib/workout/ridden';
	import { buildShelf } from '$lib/workout/shelf';

	let {
		doneHref = '/home',
	}: {
		/** Where Done goes. */
		doneHref?: string;
	} = $props();

	const profile = createProfileStore();
	const ftp = $derived(profile.current.ftp);
	const custom = customWorkouts();
	const shelf = $derived(buildShelf(custom.all));
	const flags = theRide.flags;

	const session = $derived(theRide.session);
	const signalLost = $derived(theRide.signalLost);
	const noCrashSafety = $derived(theRide.noCrashSafety);
	let tv = $state(false);
	let downloading = $state(false);
	let carding = $state(false);
	let error = $state<string | null>(null);

	// A save that answers with no page drawing the ride lands as a toast (#1544).
	$effect(() => theRide.showing());
	// Leaving the riding screen never ends the ride (ADR-0093). A summary the
	// rider walked away from is done with, so the next one opens on the setup.
	onDestroy(() => theRide.dismiss());

	// The road for the TV's horizon and its bike computer's CLIMB (#3641, #3645).
	const tvSkyline = $derived(
		session ? skylineOf(session.road, session.segments, ftp) : null,
	);

	// The block, derived once for both screens that draw it: the riding
	// surface and the TV (ADR-0046).
	const block = $derived(
		session && session.segments.length > 0
			? describeBlock(
					session.info,
					session.segments,
					session.workout,
					ftp,
					session.trace,
					// On a route whose blocks run by the clock the road is only
					// shown (ADR-0062's scenery); a road that pins them is ridden
					// in ERG to its metres, the chip as ever (#3485).
					session.road && !session.road.pinned
						? { kind: 'scenery' }
						: { kind: 'erg' },
					session.road?.readout,
				)
			: null,
	);
	// No workout, the road on: the TV draws a free ride's, no block (#4277).
	const tvBlock = $derived(
		session && isOpenRoad(session.workout) ? null : block,
	);

	/**
	 * You, in the shape the TV renders (#1632). A session's TV takes a roster
	 * and a solo ride is a roster of one: one TV screen, the tiles simply
	 * absent when nobody else is riding.
	 */
	const tvRider = $derived({
		id: 'you',
		name: 'You',
		ftp,
		kg: profile.current.kg,
		you: true,
		coach: false,
		cameraOn: false,
		muted: false,
		speaking: false,
		hue: 0,
		watts: session?.sample?.watts ?? 0,
		cadence: session?.sample?.cadence ?? 0,
		hr: session?.sample?.heartRate ?? 0,
		// The tile greys out when the trainer goes quiet, the way a session's
		// does (#2156): a hard-coded false drew a confident 0 W through a dropout.
		stale: signalLost,
		target: session?.target ?? 0,
		trace: session?.trace ?? [],
	});

	// The picture of the ride that just ended (#2112), offered where the rider
	// is standing: Strava's API takes the activity and never a photo for it.
	// Needs the saved ride, since the server draws it from the row.
	async function downloadCard() {
		const id = theRide.savedId;
		if (!id) return;
		carding = true;
		error = null;
		error = await downloadRideCard(id);
		carding = false;
	}

	/** The server owns .fit encoding (muktihari/fit is Go); the client owns the ride. */
	async function downloadFit() {
		if (!session) return;
		downloading = true;
		error = null;
		try {
			const res = await apiBlob('/api/rides/export', {
				method: 'POST',
				json: {
					startedAt: session.startedAt.toISOString(),
					// The four fields a .fit row is made of, named rather than the
					// whole recording: the encoder's decoder disallows unknown
					// fields, so anything else the recording grows (the bias added
					// for #1530 was the first) refuses the export outright.
					samples: session.recording.map((sample) => ({
						second: sample.second,
						watts: sample.watts,
						cadence: sample.cadence,
						heartRate: sample.heartRate,
					})),
				},
			});
			if (!res.ok) throw new Error(res.error.message);
			await shareFile(res.data.blob, res.data.filename ?? 'ride.fit');
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			downloading = false;
		}
	}
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (tv = false)} />

{#if theRide.road}
	<RoadRiding route={theRide.road.route} {doneHref} />
{:else if theRide.ramp}
	<!-- The ramp test draws its own steps and its own result (#1799). -->
	<RampRiding />
{:else if session && session.state !== 'done'}
	<!-- The count-in is the ride's own screen (ADR-0046, #1800): flat, the
	     one digit; over the world, the slots already in place (#3668). -->
	<!-- Under the TV the riding screen keeps running, unseen and unread: the
	     TV is then the one home of every number (D17, #3677). -->
	<div class="contents {tv ? 'invisible' : ''}" inert={tv}>
		<RidingScreen
			countIn={session.state === 'countdown'
				? {
						remaining: session.countdownRemaining,
						cancel: theRide.cancelCountdown,
					}
				: undefined}
			{session}
			{block}
			workout={session.workout}
			{ftp}
			kg={profile.current.kg}
			lthr={profile.current.lthr}
			watts={session.sample?.watts ?? 0}
			target={session.target}
			{signalLost}
			{noCrashSafety}
			onFlag={() => flags.recorder.flag()}
			onTv={() => (tv = true)}
			{shelf}
			onChangeWorkout={theRide.changeWorkout}
		/>
	</div>

	{#if tv}
		<!-- A session's TV, riding alone (#1632, ADR-0046): the same screen at
		     3 m, with the roster column absent because there is nobody in it. -->
		<!-- A snippet is a function, so the `session &&` above does not narrow
		     inside it (#2156). -->
		{@const ride = session}
		<TvOverlay
			stats={session.live}
			skyline={tvSkyline}
			climb={climbView(tvSkyline)}
			map={mapView(tvSkyline)}
			riders={[tvRider]}
			segments={session.segments}
			total={session.total}
			elapsed={session.elapsed}
			block={tvBlock}
			placeName={session.workout.name}
			workoutName={tvBlock?.label ?? ''}
			sprint={session.sprint}
			live
			onExit={() => (tv = false)}
		>
			<!-- Ride-critical status on the TV, the way a session's TV has had
			     it since #1665 (errors.md: persistent status, never a toast),
			     with the one big "Pair the trainer again" button (#2156). -->
			{#snippet status()}
				<RideStatus session={ride} {signalLost} {noCrashSafety} />
			{/snippet}
		</TvOverlay>
	{/if}
{:else if session}
	<!-- The ride is over: the summary IS the screen, with no dead HUD glowing
	     zeros behind it (#126). -->
	<div>
		<SessionSummary
			title={session.ridden.name}
			unsaved={theRide.saveStatus !== null && !theRide.savedId}
			savedXp={theRide.savedXp}
			samples={session.recording}
			{ftp}
			execution={session.scored ? session.execution : undefined}
		>
			{#snippet actions()}
				<!-- The end links forward (#1331): the ride's own page first, the
				     export and the next workout after it, Done last. -->
				{#if theRide.savedId}
					<a href="/history/{theRide.savedId}" class="btn btn-secondary"
						>See your ride</a
					>
				{:else if theRide.saving}
					<!-- The row keeps its shape while the save is in flight: the
					     button under the thumb never changes role (#1544). -->
					<button disabled class="btn btn-secondary">Saving…</button>
				{/if}
				<button
					onclick={downloadFit}
					disabled={downloading || !session?.recording.length}
					data-testid="download-fit"
					class="btn btn-secondary"
					>{downloading ? 'Preparing…' : 'Export .fit'}</button
				>
				{#if theRide.savedId}
					<button
						onclick={downloadCard}
						disabled={carding}
						data-testid="download-card"
						class="btn btn-secondary"
						>{carding ? 'Drawing…' : 'Ride card'}</button
					>
				{/if}
				<WorldPicture />
				{#if theRide.next}
					<a
						href={theRide.next.href}
						data-sveltekit-reload
						class="btn btn-secondary">{theRide.next.label}</a
					>
				{/if}
				<a href="/workouts" class="btn btn-secondary">Pick another workout</a>
				<a href={doneHref} class="btn btn-primary">Done</a>
			{/snippet}
			{#snippet status()}
				{#if theRide.saveStatus}
					<Banner tone="warn">
						{theRide.saveStatus}
						{#snippet action()}
							{#if theRide.retrySave}
								<button onclick={theRide.retrySave} class="btn btn-secondary"
									>Try again</button
								>
							{/if}
						{/snippet}
					</Banner>
				{/if}
				{#if error}
					<div class="mt-2"><Banner tone="error">{error}</Banner></div>
				{/if}
				<RideFlags {flags} />
			{/snippet}
		</SessionSummary>
	</div>
{/if}
