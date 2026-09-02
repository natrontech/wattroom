<script lang="ts">
	import Instrument from '$lib/room/Instrument.svelte';
	import ProgressBar from '$lib/components/ProgressBar.svelte';
	import { onDestroy } from 'svelte';
	import { dev } from '$app/environment';
	import Logo from '$lib/brand/Logo.svelte';
	import { FtmsTrainer } from '$lib/ble/ftms';
	import { roomConnection } from '$lib/room/connection.svelte';
	import { SimulatedTrainer } from '$lib/ble/simulated';
	import type { Trainer } from '$lib/ble/trainer';
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import { ZONE_TEXT, zoneOf } from '$lib/components/zones';
	import { formatClock } from '$lib/format';
	import { pushProfile } from '$lib/profile-sync.svelte';
	import { createProfileStore, PROFILE_LIMITS } from '$lib/profile.svelte';
	import { createRideSession } from '$lib/workout/session.svelte';
	import {
		buildRampTest,
		ftpFromRamp,
		RAMP,
		rampFailed,
		rampUsable,
	} from '$lib/workout/ramp';

	const profile = createProfileStore();
	const workout = buildRampTest();

	let session = $state<ReturnType<typeof createRideSession> | null>(null);
	let done = $state(false);
	let error = $state<string | null>(null);
	let saved = $state(false);
	let lthrSaved = $state(false);

	const supported = typeof navigator !== 'undefined' && !!navigator.bluetooth;

	// FTP is irrelevant to the test itself — the steps are absolute watts — but the
	// session needs one, so it gets the current profile value.
	async function begin(trainer: Trainer) {
		error = null;
		done = false;
		saved = false;
		lthrSaved = false;
		// One trainer, one rider (#521): the room now holds its BLE connection
		// for as long as you stand in it, so a solo ride has to take it back
		// rather than open a second control channel to the same hardware.
		roomConnection.current?.ride.unpair();
		try {
			const next = createRideSession({
				trainer,
				workout,
				ftp: profile.current.ftp,
			});
			await next.start();
			session = next;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		}
	}

	// The rider at the end of a ramp will not press a button; the test notices for them.
	$effect(() => {
		const current = session;
		if (!current || done) return;
		const trailing = current.recording.slice(-RAMP.failSeconds).map((s) => ({
			watts: s.watts,
			target: current.target,
		}));
		if (rampFailed(trailing)) {
			current.stop();
			done = true;
		}
	});

	const result = $derived(
		session
			? ftpFromRamp(session.recording.map((s) => s.watts))
			: { best: 0, ftp: 0 },
	);
	const wkg = $derived((result.ftp / profile.current.kg).toFixed(2));
	const usable = $derived(rampUsable(session?.elapsed ?? 0));
	const stepsDone = $derived(
		Math.max(
			0,
			Math.floor(
				((session?.elapsed ?? 0) - RAMP.warmupSeconds) / RAMP.stepSeconds,
			),
		),
	);
	const secondsToStep = $derived(
		session ? session.info.secondsRemainingInSegment : 0,
	);

	// LTHR suggestion (ADR-0014): a maximal ramp ends near HRmax, and the
	// SPEC's field estimate is 90 % of that. Suggested, never auto-applied —
	// the same posture as FTP suggestions.
	const maxHr = $derived(
		(session?.recording ?? []).reduce(
			(peak, sample) => Math.max(peak, sample.heartRate ?? 0),
			0,
		),
	);
	const suggestedLthr = $derived.by(() => {
		const estimate = Math.round(0.9 * maxHr);
		return estimate >= PROFILE_LIMITS.minLthr &&
			estimate <= PROFILE_LIMITS.maxLthr
			? estimate
			: 0;
	});
	function saveLthr() {
		const message = profile.update({ lthr: suggestedLthr });
		if (message) error = message;
		else lthrSaved = true;
	}

	async function saveFtp() {
		const message =
			profile.update({ ftp: result.ftp, ftpMeasuredAt: Date.now() }) ??
			(await pushProfile({ ftpWatts: result.ftp }));
		if (message) error = message;
		else saved = true;
	}
	// This page is the session's only owner: leaving mid-test ends it, or the
	// trainer holds a step with nobody watching and the frame stays caved.
	onDestroy(() => session?.stop());
</script>

<main class="page">
	<h1 class="font-display text-3xl font-bold tracking-tight">Ramp test</h1>
	<p class="text-muted mt-2 max-w-xl text-sm">
		The one workout whose point is to end. Starts at {RAMP.startWatts} W, adds
		{RAMP.stepWatts} W every minute, and stops when you can't hold the step. Your
		FTP is {Math.round(RAMP.ftpFraction * 100)} % of your best minute.
	</p>

	{#if !session}
		<div class="panel mt-8 p-8 text-center">
			<p class="text-sm">
				About 12–18 minutes, and the last two are unpleasant.
			</p>
			<p class="text-muted mx-auto mt-2 max-w-md text-xs leading-relaxed">
				Ride each minute at the number shown. When you can't hold it any more,
				stop pedalling — stopping is the measurement, not a failure.
			</p>

			{#if error}
				<p class="text-danger mt-4 text-sm">{error}</p>
			{/if}

			<div class="mt-6 flex justify-center gap-2">
				<button
					onclick={() => begin(new FtmsTrainer())}
					disabled={!supported}
					class="btn btn-primary btn-lg">Start ramp test</button
				>
				{#if dev}
					<button
						onclick={() => begin(new SimulatedTrainer({ baseWatts: 150 }))}
						class="btn btn-secondary btn-lg">Run simulated</button
					>
				{/if}
			</div>
			{#if !supported}
				<p class="text-muted mt-3 text-xs">
					This browser has no Web Bluetooth — use Chrome or Edge to pair a real
					trainer.
				</p>
			{/if}
		</div>
	{:else if !done}
		<div class="panel mt-8 p-8">
			<!-- The same instrument the room and the solo ride use (ADR-0020,
			     #386) — a ramp prescribes a step rather than a target, and that
			     is the only difference. -->
			<Instrument
				watts={session.sample?.watts ?? 0}
				target={session.target}
				ftp={profile.current.ftp}
				targetLabel="step"
			/>

			<div class="mt-8 flex items-center justify-between text-sm">
				<span class="text-muted">
					{#if session.elapsed < RAMP.warmupSeconds}
						Warm-up
					{:else}
						Step {stepsDone + 1}
					{/if}
				</span>
				<span class="font-mono tabular-nums"
					>{formatClock(session.elapsed)}</span
				>
				<span class="text-muted">
					{#if session.elapsed < RAMP.warmupSeconds}
						first step in {formatClock(Math.round(secondsToStep))}
					{:else}
						+{RAMP.stepWatts} W in {Math.round(secondsToStep)}s
					{/if}
				</span>
			</div>
			<ProgressBar
				pct={(1 -
					secondsToStep /
						(session.elapsed < RAMP.warmupSeconds
							? RAMP.warmupSeconds
							: RAMP.stepSeconds)) *
					100}
				track="bg-surface"
				fill="bg-neon transition-[width] duration-300"
				class="mt-2"
			/>

			<div class="mt-6 text-center">
				<button
					onclick={() => {
						session?.stop();
						done = true;
					}}
					class="border-muted/30 hover:border-muted/60 rounded border px-5 py-2.5 text-sm"
					>I'm done</button
				>
			</div>
		</div>
	{:else if !usable}
		<div class="panel mt-8 p-8">
			<h2 class="font-display text-2xl font-bold">Not enough to measure</h2>
			<p class="text-muted mt-3 max-w-md text-sm leading-relaxed">
				You stopped after {formatClock(session.elapsed)}. The test needs the
				{formatClock(RAMP.warmupSeconds)} warm-up plus at least {RAMP.minSteps}
				steps before the number means anything.
			</p>
			<div class="mt-6 flex gap-2">
				<a href="/ramp" class="btn btn-primary">Test again</a>
				<a href="/workouts" class="btn btn-secondary">Ride something else</a>
			</div>
		</div>
	{:else}
		<div class="panel mt-8 p-8">
			<p class="eyebrow">your new FTP</p>
			<div class="mt-2 flex items-baseline gap-2">
				<span
					class="text-watt glow-text-strong font-display text-7xl leading-none font-bold tabular-nums"
					>{result.ftp}</span
				>
				<span class="text-muted text-xl">W</span>
			</div>
			<p class="text-muted mt-4 text-xs leading-relaxed">
				Best minute was {result.best} W, and FTP is {Math.round(
					RAMP.ftpFraction * 100,
				)} % of that. You lasted {formatClock(session.elapsed)} — {stepsDone}
				steps. Every workout you ride from here scales to this number.
			</p>
			<p class="mt-3 text-sm">
				That's <span class={ZONE_TEXT[zoneOf(result.ftp, result.ftp)]}
					>{wkg} w/kg</span
				>
				at {profile.current.kg} kg.
			</p>

			{#if error}
				<p class="text-danger mt-4 text-sm">{error}</p>
			{/if}

			{#if saved}
				<p
					class="border-z4/40 bg-z4/10 mt-6 rounded-lg border px-4 py-3 text-sm"
				>
					Saved. Every workout now scales to {result.ftp} W.
				</p>
				<a href="/workouts" class="btn btn-secondary mt-3">Pick a workout</a>
			{:else}
				<div class="mt-6 flex gap-2">
					<button
						onclick={saveFtp}
						disabled={result.ftp === 0}
						class="btn btn-primary">Save {result.ftp} W</button
					>
					<a href="/ramp" class="btn btn-secondary">Test again</a>
					<!-- Never silently change FTP: it moves every workout's difficulty. -->
					<a
						href="/profile"
						class="text-muted hover:text-ink self-center py-2 text-xs underline"
						>Keep my current {profile.current.ftp} W</a
					>
				</div>
			{/if}

			{#if suggestedLthr > 0}
				<div class="border-ink/5 mt-6 border-t pt-4">
					{#if lthrSaved}
						<p class="text-z4 text-xs">
							LTHR set to {suggestedLthr} bpm — your heart-rate zones now follow it.
						</p>
					{:else}
						<p class="text-muted text-xs">
							Your heart rate peaked at {maxHr} bpm — that puts your LTHR around
							{suggestedLthr} bpm{profile.current.lthr
								? ` (currently ${profile.current.lthr})`
								: ''}.
						</p>
						<button onclick={saveLthr} class="btn btn-secondary btn-xs mt-2"
							>Set LTHR to {suggestedLthr}</button
						>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</main>
