<script lang="ts">
	import { dev } from '$app/environment';
	import Logo from '$lib/brand/Logo.svelte';
	import { FtmsTrainer } from '$lib/ble/ftms';
	import { SimulatedTrainer } from '$lib/ble/simulated';
	import type { Trainer } from '$lib/ble/trainer';
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import { ZONE_TEXT, zoneOf } from '$lib/components/zones';
	import { formatClock } from '$lib/format';
	import { pushProfile } from '$lib/profile-sync.svelte';
	import { createProfileStore } from '$lib/profile.svelte';
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

	const supported = typeof navigator !== 'undefined' && !!navigator.bluetooth;

	// FTP is irrelevant to the test itself — the steps are absolute watts — but the
	// session needs one, so it gets the current profile value.
	async function begin(trainer: Trainer) {
		error = null;
		done = false;
		saved = false;
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

	async function saveFtp() {
		const message =
			profile.update({ ftp: result.ftp, ftpMeasuredAt: Date.now() }) ??
			(await pushProfile({ ftpWatts: result.ftp }));
		if (message) error = message;
		else saved = true;
	}
</script>

<main class="mx-auto max-w-3xl px-6 py-10">
	<h1 class="font-display text-3xl font-bold tracking-tight">Ramp test</h1>
	<p class="text-muted mt-2 max-w-xl text-sm">
		The one workout whose point is to end. Starts at {RAMP.startWatts} W, adds
		{RAMP.stepWatts} W every minute, and stops when you can't hold the step. Your
		FTP is {Math.round(RAMP.ftpFraction * 100)} % of your best minute.
	</p>

	{#if !session}
		<div
			class="border-muted/15 bg-surface-raised mt-8 rounded-lg border p-8 text-center"
		>
			<p class="text-sm">
				About 12–18 minutes, and the last two are unpleasant.
			</p>
			<p class="text-muted mx-auto mt-2 max-w-md text-xs leading-relaxed">
				Ride each minute at the number shown. When you can't hold it any more,
				stop pedalling — stopping is the measurement, not a failure.
			</p>

			{#if error}
				<p class="text-z6 mt-4 text-sm">{error}</p>
			{/if}

			<div class="mt-6 flex justify-center gap-2">
				<button
					onclick={() => begin(new FtmsTrainer())}
					disabled={!supported}
					class="bg-ink text-paper hover:bg-ink/90 rounded px-5 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
					>Start ramp test</button
				>
				{#if dev}
					<button
						onclick={() => begin(new SimulatedTrainer({ baseWatts: 150 }))}
						class="border-muted/30 hover:border-muted/60 rounded border px-5 py-3 text-sm"
						>Run simulated</button
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
		<div class="border-muted/15 bg-surface-raised mt-8 rounded-lg border p-8">
			<div class="flex items-end justify-between gap-6">
				<div>
					<div class="flex items-baseline gap-2">
						<span
							class="text-watt glow-text-strong font-display text-7xl leading-none font-bold tabular-nums"
							>{session.sample?.watts ?? 0}</span
						>
						<span class="text-muted text-xl">W</span>
					</div>
					<p class="text-muted mt-2 text-[10px] tracking-wider uppercase">
						your power
					</p>
				</div>
				<div class="text-right">
					<div
						class="font-display text-4xl leading-none font-bold tabular-nums"
					>
						{session.target}
					</div>
					<p class="text-muted mt-2 text-[10px] tracking-wider uppercase">
						hold this
					</p>
				</div>
			</div>

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
			<div class="bg-surface mt-2 h-1.5 overflow-hidden rounded-full">
				<div
					class="bg-neon h-full transition-[width] duration-300"
					style="width: {(1 -
						secondsToStep /
							(session.elapsed < RAMP.warmupSeconds
								? RAMP.warmupSeconds
								: RAMP.stepSeconds)) *
						100}%"
				></div>
			</div>

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
		<div class="border-muted/15 bg-surface-raised mt-8 rounded-lg border p-8">
			<h2 class="font-display text-2xl font-bold">Not enough to measure</h2>
			<p class="text-muted mt-3 max-w-md text-sm leading-relaxed">
				You stopped after {formatClock(session.elapsed)}. The test needs the
				{formatClock(RAMP.warmupSeconds)} warm-up plus at least {RAMP.minSteps}
				steps before the number means anything.
			</p>
			<div class="mt-6 flex gap-2">
				<a
					href="/ramp"
					class="bg-ink text-paper hover:bg-ink/90 rounded px-4 py-2.5 text-sm font-medium"
					>Test again</a
				>
				<a
					href="/workouts"
					class="border-muted/30 hover:border-muted/60 rounded border px-4 py-2.5 text-sm"
					>Ride something else</a
				>
			</div>
		</div>
	{:else}
		<div class="border-muted/15 bg-surface-raised mt-8 rounded-lg border p-8">
			<p class="text-muted text-[10px] tracking-[0.2em] uppercase">
				your new FTP
			</p>
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
				<p class="text-z6 mt-4 text-sm">{error}</p>
			{/if}

			{#if saved}
				<p
					class="border-z4/40 bg-z4/10 mt-6 rounded-lg border px-4 py-3 text-sm"
				>
					Saved. Every workout now scales to {result.ftp} W.
				</p>
				<a
					href="/workouts"
					class="border-muted/30 hover:border-muted/60 mt-3 inline-block rounded border px-4 py-2.5 text-sm"
					>Pick a workout</a
				>
			{:else}
				<div class="mt-6 flex gap-2">
					<button
						onclick={saveFtp}
						disabled={result.ftp === 0}
						class="bg-ink text-paper hover:bg-ink/90 rounded px-4 py-2.5 text-sm font-medium disabled:opacity-40"
						>Save {result.ftp} W</button
					>
					<a
						href="/ramp"
						class="border-muted/30 hover:border-muted/60 rounded border px-4 py-2.5 text-sm"
						>Test again</a
					>
					<!-- Never silently change FTP: it moves every workout's difficulty. -->
					<a
						href="/profile"
						class="text-muted hover:text-ink self-center py-2 text-xs underline"
						>Keep my current {profile.current.ftp} W</a
					>
				</div>
			{/if}
		</div>
	{/if}
</main>
