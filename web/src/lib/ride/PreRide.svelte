<script lang="ts">
	import { PROFILE_LIMITS } from '$lib/profile.svelte';
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
	import Logo from '$lib/brand/Logo.svelte';
	import { canSimulate } from '$lib/ble/can-simulate';
	import { FtmsTrainer } from '$lib/ble/ftms';
	import { SimulatedTrainer } from '$lib/ble/simulated';
	import type { Trainer } from '$lib/ble/trainer';
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import { device } from '$lib/device.svelte';
	import { formatClock } from '$lib/format';
	import RecoveredRides from '$lib/ride/RecoveredRides.svelte';
	import type { createSoloTrainer } from '$lib/ride/solo-trainer.svelte';
	import SensorOverview from '$lib/room/SensorOverview.svelte';
	import { durationSeconds, flatten } from '$lib/workout/engine';
	import type { Workout } from '$lib/workout/types';

	let {
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
	}: {
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
	} = $props();
</script>

<!-- Pre-ride: pick your effort level and how you are getting power in. -->
<div class="m-auto w-full max-w-2xl text-center">
	<Logo size={56} />
	<h1 class="font-display mt-6 text-2xl font-bold">{workout.name}</h1>
	<p class="text-muted mt-2 text-sm">
		{formatClock(durationSeconds(workout))} · targets scale to your FTP
	</p>

	<p class="text-muted mt-4 text-xs">{summary}</p>

	<!-- What the session looks like — the one thing to see before Start. -->
	<div class="panel mt-4 overflow-hidden">
		<IntervalGraph
			segments={flatten(workout)}
			total={durationSeconds(workout)}
			elapsed={0}
			{ftp}
			trace={[]}
		/>
	</div>
	<a
		href="/workouts"
		class="text-muted hover:text-ink mt-3 inline-block text-xs underline"
		>Choose a different workout</a
	>

	<!-- The same paired-devices grid the room's Training place draws
	     (#611). Pairing lives here, so Start does one thing — and the
	     trainer reports watts before the ride rather than after. -->
	<div class="mt-6">
		<SensorOverview
			trainer={{
				state: solo.state,
				device: solo.trainer?.name,
				reading: solo.reading,
				hint:
					solo.fault === 'silent'
						? 'no watts yet — turn the cranks'
						: undefined,
				error: solo.error,
				onPair: () => void solo.pair(new FtmsTrainer()),
				onForget: () => solo.forget(),
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
		<p class="text-danger mt-4 text-sm">{error}</p>
	{/if}

	<div class="mt-6 grid gap-2">
		<!-- Never render a button that will fail (errors.md): with no
		     trainer there is nothing to hold a target. -->
		<button
			onclick={() => {
				const trainer = solo.handOff();
				if (trainer) onStart(trainer);
			}}
			disabled={!solo.trainer}
			class="btn btn-primary btn-lg">Start the ride</button
		>
		{#if replayName}
			<button
				onclick={onReplay}
				data-testid="ride-replay"
				class="btn btn-accent btn-lg">Replay {replayName}</button
			>
		{/if}
	</div>
	{#if device.spectator}
		<!-- The grid above is hidden on a spectator device, so the
		     disabled button needs its own reason (errors.md). -->
		<p class="text-muted mt-3 text-xs">
			This device can't reach a trainer — its browser has no Web Bluetooth. Ride
			from a desktop, or Chrome on Android.
		</p>
	{:else if !solo.trainer}
		<p class="text-muted mt-3 text-xs">
			Pair your trainer above to start — the workout's targets need something to
			hold them.
		</p>
	{/if}

	<!-- Below Start on purpose: the grid made this column taller than a
	     laptop window, and FTP is a number you correct once in a month
	     while Start is what you came for. -->
	<label class="mt-8 block text-left">
		<span class="eyebrow">your FTP (watts)</span>
		<input
			type="number"
			value={ftp}
			onchange={(event) => onFtp(Number(event.currentTarget.value))}
			min={PROFILE_LIMITS.minFtp}
			max={PROFILE_LIMITS.maxFtp}
			class="input mt-1 w-full font-mono tabular-nums"
		/>
	</label>
	<a
		href="/ramp"
		class="text-muted hover:text-ink mt-2 inline-block text-xs underline"
		>Measure it with a ramp test</a
	>

	<RecoveredRides {onError} />
</div>
