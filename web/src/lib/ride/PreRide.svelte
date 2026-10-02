<script lang="ts">
	import { PROFILE_LIMITS } from '$lib/profile.svelte';
	import Banner from '$lib/components/Banner.svelte';
	/**
	 * Everything before the ride starts (#1057): what you are about to do, what
	 * is going to measure it, and the one number the targets scale to.
	 *
	 * The ride screen was two screens in one file, and a rider is never looking
	 * at both. This is the half with no session behind it — which is also what
	 * makes it the half that can be exercised without a trainer.
	 *
	 * It owns no state. The page keeps the session, the profile and the error,
	 * because the riding half needs all three; this takes what it draws and
	 * hands back what the rider pressed.
	 */
	import { canSimulate } from '$lib/ble/can-simulate';
	import { FtmsTrainer } from '$lib/ble/ftms';
	import { SimulatedTrainer } from '$lib/ble/simulated';
	import type { Trainer } from '$lib/ble/trainer';
	import { device } from '$lib/device.svelte';
	import RecoveredRides from '$lib/ride/RecoveredRides.svelte';
	import RideCard, { type RideKind } from '$lib/ride/RideCard.svelte';
	import type { RideableRoute } from '$lib/ride/roads';
	import type { createSoloTrainer } from '$lib/ride/solo-trainer.svelte';
	import SensorOverview from '$lib/session/SensorOverview.svelte';
	import type { Workout } from '$lib/workout/types';
	import { heldTrainer } from '$lib/session/sensor-status';
	import { account, unchosen } from '$lib/account.svelte';
	import { channelConnection } from '$lib/channel/connection.svelte';

	let {
		kind = $bindable(),
		road = $bindable(),
		from = $bindable(),
		roadId,
		remembered,
		lastWorkout,
		games,
		workout,
		summary,
		ftp,
		solo,
		replayName,
		error,
		onStart,
		onReplay,
		onFtp,
		onError,
		onSaved,
	}: {
		/** The Ride card's three answers (#3671), the page's to start. */
		kind: RideKind;
		road: RideableRoute | null;
		from: number;
		roadId?: string;
		remembered?: string;
		lastWorkout?: string;
		games: boolean;
		workout: Workout;
		/** What this effort is, in one line — the library's own words. */
		summary: string;
		ftp: number;
		/** The pairing store, so the card below stays one wiring (#611). */
		solo: ReturnType<typeof createSoloTrainer>;
		/** A fixture the rider may ride instead, when one is named in the URL. */
		replayName: string | null;
		/** The page's persistent status — never a toast (errors.md). */
		error: string | null;
		onStart: (trainer: Trainer) => void;
		onReplay: () => void;
		onFtp: (next: number) => void;
		onError: (message: string | null) => void;
		/** A recovered ride reached the account (#1544). */
		onSaved?: (ride: { startedAt: number }) => void;
	} = $props();

	// The trainer a voice channel holds counts as paired here too (#2635),
	// and Start rides it (solo.handOff takes it over, still connected).
	const held = $derived(heldTrainer(solo, channelConnection.current?.ride));
	// The FTP nobody chose (docs/SPEC.md, "The rider's two numbers"): said so,
	// and asked above Start rather than after it.
	const guessed = $derived(unchosen(account.me?.ftpSource));
	// A free ride alone rides one of your roads: there is no flat one here.
	const roadless = $derived(kind === 'free' && !road);
	let pending = $state(false);
</script>

<!-- Pre-ride (#3671): the Ride card first, then what measures it, then the
     one number the targets scale to. A desk page: it fills the column from
     the top left (ADR-0020 amended). -->
<div class="flex w-full flex-col gap-6">
	<!-- First, not at the foot under FTP (#2616): a ride to rescue outranks
	     the one about to start, and the column is taller than a laptop. -->
	<RecoveredRides {onError} {onSaved} />
	<h1 class="page-title">Ride</h1>
	<RideCard
		bind:kind
		bind:road
		bind:from
		bind:pending
		{roadId}
		{remembered}
		{lastWorkout}
		{workout}
		{summary}
		{ftp}
		{games}
	/>

	<!-- The same paired-devices grid a voice channel's Training place draws
	     (#611). Pairing lives here, so Start does one thing — and the
	     trainer reports watts before the ride rather than after. -->
	<div>
		<SensorOverview
			trainer={{
				state: held.state,
				device: held.device,
				reading: held.reading,
				hint: held.hint,
				error: held.error,
				onPair: () => void solo.pair(new FtmsTrainer()),
				onForget: held.forget,
				// Simulated watts pair like any other trainer rather than
				// starting the ride outright: the card is where a rider
				// (and the e2e) sees a trainer reporting before Start.
				onSimulate: canSimulate()
					? () => void solo.pair(new SimulatedTrainer({ baseWatts: ftp * 0.8 }))
					: undefined,
			}}
		/>
	</div>

	{#if error}
		<Banner tone="error">{error}</Banner>
	{/if}

	{#if guessed}{@render ftpField()}{/if}

	<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
		<!-- Never render a button that will fail (errors.md): with no
		     trainer there is nothing to hold a target, and with no road a
		     free ride alone has nothing to ride. -->
		<button
			onclick={() => {
				const trainer = solo.handOff();
				if (trainer) onStart(trainer);
			}}
			disabled={!held.paired ||
				held.fault === 'reconnecting' ||
				pending ||
				roadless}
			class="btn btn-primary btn-lg">Start the ride</button
		>
		{#if held.fault === 'reconnecting'}
			<!-- Never a control that will fail (ux.md, #1851): a start on a
			     trainer mid-reattach opened a second chooser over the ride. -->
			<p class="text-muted text-xs">Waiting for the trainer to come back.</p>
		{/if}
		{#if device.spectator}
			<!-- The grid above is hidden on a spectator device, so the
			     disabled button needs its own reason (errors.md). -->
			<p class="text-muted text-sm">
				This device can't reach a trainer — its browser has no Web Bluetooth.
				Ride from a desktop, or Chrome on Android.
			</p>
		{:else if !held.paired}
			<p class="text-muted text-sm">
				Pair your trainer above to start — {kind === 'free'
					? 'the road needs something to set its slope.'
					: "the workout's targets need something to hold them."}
			</p>
		{:else if roadless}
			<p class="text-muted text-sm">
				A free ride alone rides one of your roads — pick one with Change.
			</p>
		{/if}
		{#if replayName}
			<button
				onclick={onReplay}
				data-testid="ride-replay"
				class="btn btn-accent btn-lg">Replay {replayName}</button
			>
		{/if}
	</div>

	<!-- Below Start on purpose: the grid made this column taller than a
	     laptop window, and FTP is a number you correct once in a month
	     while Start is what you came for — unless nobody chose it yet, when
	     it is the question to answer first (above). -->
	{#if !guessed}{@render ftpField()}{/if}
</div>

{#snippet ftpField()}
	<div>
		<label class="block">
			<span class="eyebrow">your FTP (watts)</span>
			<input
				type="number"
				value={ftp}
				onchange={(event) => onFtp(Number(event.currentTarget.value))}
				min={PROFILE_LIMITS.minFtp}
				max={PROFILE_LIMITS.maxFtp}
				class="input num mt-1 block w-40"
			/>
			{#if guessed}
				<!-- Profile's words (#1484): an unchosen number never reads as a
			     measured one. -->
				<span class="text-muted mt-1 block text-xs"
					>This {ftp} W is where we start everyone, not a measurement.</span
				>
			{/if}
		</label>
		<a
			href="/ramp"
			class="text-muted hover:text-ink mt-1 inline-flex min-h-6 items-center text-xs underline"
			>Measure it with a ramp test</a
		>
	</div>
{/snippet}
