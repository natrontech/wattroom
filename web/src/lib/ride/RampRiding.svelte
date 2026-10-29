<script lang="ts">
	/**
	 * The ramp test under way, drawn (ADR-0093): its count-in, its riding
	 * surface, its TV and its result. The test is `theRide`'s; this view only
	 * reads it, so the rider can leave it for the crew and come back to it on
	 * /ramp or /ride.
	 */
	import { goto } from '$app/navigation';
	import Banner from '$lib/components/Banner.svelte';
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import { formatClock } from '$lib/format';
	import { createProfileStore } from '$lib/profile.svelte';
	import { askToStopRamp } from '$lib/ride/end-ride';
	import FlagButton from '$lib/ride/FlagButton.svelte';
	import { FLAG_NOTICE_MS, FLAG_SAID } from '$lib/ride/flag';
	import RampResult from '$lib/ride/RampResult.svelte';
	import RideFlags from '$lib/ride/RideFlags.svelte';
	import RideStatus from '$lib/ride/RideStatus.svelte';
	import { theRide } from '$lib/ride/the-ride.svelte';
	import BiasTrim from '$lib/session/BiasTrim.svelte';
	import BikeComputer from '$lib/session/BikeComputer.svelte';
	import CountdownScreen from '$lib/session/CountdownScreen.svelte';
	import RideBand from '$lib/session/RideBand.svelte';
	import { rideContext } from '$lib/session/ride-context';
	import RidingSurface from '$lib/session/RidingSurface.svelte';
	import TvOverlay from '$lib/session/TvOverlay.svelte';
	import { describeBlock } from '$lib/workout/block';
	import { RAMP, rampUsable } from '$lib/workout/ramp';

	const profile = createProfileStore();
	const flags = theRide.flags;
	const session = $derived(theRide.session);
	const ramp = $derived(theRide.ramp);
	const done = $derived(!!ramp?.done);
	const signalLost = $derived(theRide.signalLost);
	const noCrashSafety = $derived(theRide.noCrashSafety);

	// The ⚑ and the TV, as /ride has them (#1799, ADR-0046): a ramp that goes
	// wrong is exactly what the flag exists to report.
	let tv = $state(false);
	let flagNotice = $state(false);
	function flag() {
		flags.recorder.flag();
		flagNotice = true;
		setTimeout(() => (flagNotice = false), FLAG_NOTICE_MS);
	}

	// "Test again" used to be a link to this page, which a same-route
	// navigation leaves exactly as it was (#1797). The finished test is let
	// go, and /ramp opens on its setup with the trainer back in the grid.
	function restart() {
		theRide.dismiss();
		void goto('/ramp');
	}

	const usable = $derived(rampUsable(session?.elapsed ?? 0));
	const stepsDone = $derived(
		Math.max(
			0,
			Math.floor(
				((session?.elapsed ?? 0) - RAMP.warmupSeconds) / RAMP.stepSeconds,
			),
		),
	);
	// The same header every other ride gets (ADR-0046). The ramp counts its own
	// steps, because the warm-up is segment one and "step 1" must not name it;
	// everything else in the block — the next step's ABSOLUTE watts above all —
	// falls out of the shared view model.
	const block = $derived(
		session && session.segments.length > 0
			? describeBlock(
					session.info,
					session.segments,
					session.workout,
					profile.current.ftp,
					session.trace,
				)
			: null,
	);
	const stepEyebrow = $derived(
		(session?.elapsed ?? 0) < RAMP.warmupSeconds
			? 'warm-up'
			: `step ${stepsDone + 1} of ${RAMP.steps}`,
	);
	/** The test's own top, in FTP fractions — the graph's scale, as #1565 gave
	 *  the gauge one. */
	const rampCeiling = $derived(
		(RAMP.startWatts + RAMP.steps * RAMP.stepWatts) / profile.current.ftp,
	);

	// A stray "I'm done" at step 8 ended the test and offered an under-read
	// FTP behind a big Save (#2623). The ramp ends itself when the rider
	// blows, so the button is for stopping early — and that asks first.
	async function stopTest() {
		if (await askToStopRamp()) theRide.ramp?.stop();
	}
</script>

{#snippet rideLine()}
	{#if theRide.savedId}
		<p class="text-muted mt-3 text-xs">
			The riding is on your history too — <a
				href="/history/{theRide.savedId}"
				class="underline">see the ride</a
			>.
		</p>
	{:else if theRide.saveStatus}
		<div class="mt-3">
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
		</div>
	{/if}
	{#if ramp?.ftpMarkStatus}
		<div class="mt-3"><Banner tone="warn">{ramp.ftpMarkStatus}</Banner></div>
	{/if}
{/snippet}

{#snippet rampControls()}
	<div class="flex flex-wrap items-center justify-end gap-2">
		<button onclick={() => (tv = true)} class="btn btn-secondary btn-ride"
			>TV</button
		>
		<button onclick={stopTest} class="btn btn-secondary btn-ride"
			>I'm done</button
		>
		<FlagButton onflag={flag} sends="after" />
	</div>
{/snippet}

{#snippet rampStatus()}
	<!-- The guard states and the dropout, as /ride says them (#1799). -->
	{#if session}<RideStatus {session} {signalLost} {noCrashSafety} line />{/if}
{/snippet}

{#snippet strip()}
	<!-- The staircase's cursor, in slot 1. -->
	{#if session}
		<IntervalGraph
			segments={session.segments}
			total={session.total}
			elapsed={session.elapsed}
			ftp={profile.current.ftp}
			ceiling={rampCeiling}
			trace={session.trace}
			compact
			marker={false}
		/>
	{/if}
{/snippet}

<svelte:window onkeydown={(e) => e.key === 'Escape' && (tv = false)} />

{#if session}
	<h1 class="page-title">Ramp test</h1>
	<!-- A riding surface has no sentences but its status line (G4). -->
	{#if done}
		<p class="text-muted mt-2 max-w-xl text-sm">
			The one workout whose point is to end. Starts at {RAMP.startWatts} W, adds
			{RAMP.stepWatts} W every minute, and stops when you can't hold the step. Your
			FTP is {Math.round(RAMP.ftpFraction * 100)} % of your best minute.
		</p>
	{/if}

	{#if session.state === 'countdown'}
		<!-- One count-in for the surface (ADR-0046, #1800): the same screen a
		     session and /ride draw, so the test starts the way every ride does. -->
		<div class="mt-8 min-h-[24rem]">
			<CountdownScreen
				remaining={session.countdownRemaining}
				title={session.workout.name}
				note="first up · {RAMP.startWatts} W warm-up"
			>
				{#snippet controls()}
					<!-- The trainer goes back to the pre-ride, still paired (#2615). -->
					<button
						onclick={theRide.cancelCountdown}
						class="btn btn-secondary btn-ride">Cancel</button
					>
				{/snippet}
			</CountdownScreen>
		</div>
	{:else if !done}
		<!-- One riding surface (ADR-0046): the header, the instrument, your own
		     numbers and the horizon, in the order a session and the solo ride use
		     them. The ramp's real differences are two words — it prescribes a
		     STEP, and it counts steps rather than blocks. -->
		<!-- The bottom padding is the floating navigation button's, as
		     RidingScreen has it (ux.md: the last item clears the chrome) — the
		     graph's bottom-left corner sat under it at 375 px (#2161). -->
		<RidingSurface class="mt-8 min-h-[32rem] flex-1 pb-16 sm:pb-0">
			{#snippet header()}
				<RideBand
					{block}
					elapsed={session.elapsed}
					total={session.total}
					title={session.workout.name}
					unit="step"
					context={rideContext('Solo', session.workout.name)}
					drives
					wide
					eyebrow={stepEyebrow}
					controls={rampControls}
					status={rampStatus}
					{strip}
				/>
			{/snippet}
			{#snippet focus()}{/snippet}
			{#snippet numbers()}
				<!-- The test records heart rate for its whole length and reads the
				     peak to suggest an LTHR, and never showed the rider a bpm
				     (#1531). The head holds the one watts figure. -->
				<BikeComputer
					docked
					ftp={profile.current.ftp}
					cadence={session.sample?.cadence ?? 0}
					stale={signalLost}
					hr={session.sample?.heartRate ?? 0}
					watts={session.sample?.watts ?? 0}
					kg={profile.current.kg}
					lthr={profile.current.lthr}
					target={session.target > 0 ? session.target : undefined}
					stats={session.live}
				/>
				<div class="px-4 pb-3">
					<BiasTrim
						ride
						bias={session.bias}
						onBias={(step) => session.nudgeBias(step)}
					/>
				</div>
				{#if flagNotice}
					<!-- Consent in plain words, at the moment of the tap, never blocking. -->
					<p class="text-muted px-4 pb-3 text-xs">{FLAG_SAID.after}</p>
				{/if}
			{/snippet}
			{#snippet horizon()}
				<!-- The staircase, and how far up it you are. Scaled to the test's
				     own top, not the FTP it exists to correct (#1565). -->
				<div class="relative min-h-28 flex-1">
					<div class="absolute inset-0">
						<IntervalGraph
							ride
							marker={!signalLost}
							segments={session.segments}
							total={session.total}
							elapsed={session.elapsed}
							ftp={profile.current.ftp}
							ceiling={rampCeiling}
							trace={session.trace}
						/>
					</div>
				</div>
			{/snippet}
		</RidingSurface>
	{:else if !usable}
		<div class="panel mt-8 p-8">
			<h2 class="font-display text-2xl font-bold">Not enough to measure</h2>
			<p class="text-muted mt-3 max-w-md text-sm leading-relaxed">
				You stopped after {formatClock(session.elapsed)}. The test needs the
				{formatClock(RAMP.warmupSeconds)} warm-up plus at least {RAMP.minSteps}
				steps before the number means anything.
			</p>
			{@render rideLine()}
			<RideFlags {flags} />
			<div class="mt-6 flex gap-2">
				<button onclick={restart} class="btn btn-primary">Test again</button>
				<a href="/workouts" class="btn btn-secondary">Ride something else</a>
			</div>
		</div>
	{:else}
		<!-- The number, and what to do with it: its own component (#1799). -->
		<RampResult
			{session}
			{stepsDone}
			onRestart={restart}
			onFtpSaved={(ftp) => theRide.ramp?.accept(ftp)}
		>
			{@render rideLine()}
			<RideFlags {flags} />
		</RampResult>
	{/if}

	{#if !done && session.state !== 'done' && tv}
		<!-- A session's TV, on the ramp (#1799, ADR-0046): the same screen at 3 m. -->
		<!-- A snippet is a function, so the `session` above does not narrow
		     inside it (#2156). -->
		{@const ride = session}
		<TvOverlay
			stats={session.live}
			riders={[
				{
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
					watts: session.sample?.watts ?? 0,
					cadence: session.sample?.cadence ?? 0,
					hr: session.sample?.heartRate ?? 0,
					// Grey when the trainer is quiet (#2156), not a confident 0 W.
					stale: signalLost,
					target: session.target,
					trace: session.trace,
				},
			]}
			segments={session.segments}
			total={session.total}
			elapsed={session.elapsed}
			{block}
			placeName={session.workout.name}
			workoutName={block?.label ?? ''}
			live
			onExit={() => (tv = false)}
		>
			<!-- The same status the page draws, on the screen the rider is
			     actually watching (#2156). A ramp is the test whose number you
			     keep: a dropout that goes unsaid here costs the whole test. -->
			{#snippet status()}
				<RideStatus session={ride} {signalLost} {noCrashSafety} />
			{/snippet}
		</TvOverlay>
	{/if}
{/if}
