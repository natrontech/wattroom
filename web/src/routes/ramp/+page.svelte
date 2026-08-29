<script lang="ts">
	import Logo from '$lib/brand/Logo.svelte';
	import { FtmsTrainer } from '$lib/ble/ftms';
	import { SimulatedTrainer } from '$lib/ble/simulated';
	import type { Trainer } from '$lib/ble/trainer';
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import { formatClock } from '$lib/components/zones';
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

	function saveFtp() {
		const message = profile.update({
			ftp: result.ftp,
			ftpMeasuredAt: Date.now(),
		});
		if (message) error = message;
		else saved = true;
	}
</script>

<main class="mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-10">
	{#if !session}
		<div class="m-auto w-full text-center">
			<Logo size={56} />
			<h1 class="font-display mt-6 text-2xl font-bold">Ramp test</h1>
			<p class="text-muted mx-auto mt-3 max-w-md text-sm leading-relaxed">
				Starts at {RAMP.startWatts} W and adds {RAMP.stepWatts} W every minute until
				you cannot hold it. Your FTP is {Math.round(RAMP.ftpFraction * 100)}% of
				your best minute.
			</p>
			<p class="text-muted mx-auto mt-3 max-w-md text-xs leading-relaxed">
				About 12–18 minutes, and the last two are unpleasant. When you cannot
				hold the number any more, stop pedalling — stopping is the measurement,
				not a failure.
			</p>

			{#if error}
				<p class="text-z6 mt-4 text-sm">{error}</p>
			{/if}

			<div class="mx-auto mt-8 grid max-w-xs gap-2">
				<button
					onclick={() => begin(new FtmsTrainer())}
					disabled={!supported}
					class="rounded bg-white px-5 py-3 text-sm font-semibold text-black hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-40"
					>Pair trainer and start</button
				>
				<button
					onclick={() => begin(new SimulatedTrainer({ baseWatts: 150 }))}
					class="border-muted/30 hover:border-muted/60 rounded border px-5 py-3 text-sm"
					>Run simulated</button
				>
			</div>
			{#if !supported}
				<p class="text-muted mt-3 text-xs">
					This browser has no Web Bluetooth — use Chrome or Edge to pair a real
					trainer.
				</p>
			{/if}
		</div>
	{:else if !done}
		<div class="m-auto w-full">
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

			<div class="text-muted mt-8 flex items-center justify-between text-sm">
				<span>{formatClock(session.elapsed)} elapsed</span>
				<span class="font-mono tabular-nums"
					>{formatClock(session.info.secondsRemainingInSegment)} left on this step</span
				>
			</div>
			<div class="bg-surface-raised mt-2 h-1.5 overflow-hidden rounded-full">
				<div
					class="bg-neon h-full transition-[width] duration-500"
					style="width: {(1 -
						session.info.secondsRemainingInSegment / RAMP.stepSeconds) *
						100}%"
				></div>
			</div>

			<div
				class="border-muted/15 bg-surface-raised mt-6 overflow-hidden rounded-lg border"
			>
				<IntervalGraph
					segments={session.segments}
					total={session.total}
					elapsed={session.elapsed}
					ftp={profile.current.ftp}
					trace={session.trace}
				/>
			</div>

			<button
				onclick={() => {
					session?.stop();
					done = true;
				}}
				class="border-muted/30 hover:border-muted/60 mt-4 w-full rounded border px-5 py-3 text-sm"
				>I'm done</button
			>
		</div>
	{:else}
		<div class="m-auto w-full max-w-md text-center">
			{#if !usable}
				<!-- No headline number: a figure this size reads as the answer whatever
				     the caption says, and this one is derived from a warmup. -->
				<h1 class="font-display text-2xl font-bold">Not enough to measure</h1>
				<p class="text-muted mt-3 text-sm leading-relaxed">
					You stopped after {formatClock(session.elapsed)}. The test needs the
					{formatClock(RAMP.warmupSeconds)} warmup plus at least {RAMP.minSteps} steps
					before the number means anything.
				</p>
			{:else}
				<p class="text-muted text-[10px] tracking-[0.2em] uppercase">
					your new FTP
				</p>
				<div class="mt-2 flex items-baseline justify-center gap-2">
					<span
						class="text-watt glow-text-strong font-display text-7xl leading-none font-bold tabular-nums"
						>{result.ftp}</span
					>
					<span class="text-muted text-xl">W</span>
				</div>
				<p class="text-muted mt-4 text-sm leading-relaxed">
					Best minute was {result.best} W, and FTP is {Math.round(
						RAMP.ftpFraction * 100,
					)}% of that. You lasted {formatClock(session.elapsed)}.
				</p>
				<p class="mt-2 text-sm">{wkg} w/kg at {profile.current.kg} kg</p>
			{/if}

			{#if error}
				<p class="text-z6 mt-4 text-sm">{error}</p>
			{/if}

			<div class="mt-8 grid gap-2">
				{#if !usable}
					<a
						href="/ramp"
						class="rounded bg-white px-5 py-3 text-sm font-semibold text-black hover:bg-white/90"
						>Try again</a
					>
					<a
						href="/workouts"
						class="text-muted py-2 text-xs underline hover:text-white"
						>Ride something else instead</a
					>
				{:else if saved}
					<p class="border-z4/40 bg-z4/10 rounded-lg border px-4 py-3 text-sm">
						Saved. Every workout now scales to {result.ftp} W.
					</p>
					<a
						href="/workouts"
						class="border-muted/30 hover:border-muted/60 rounded border px-5 py-3 text-sm"
						>Pick a workout</a
					>
				{:else}
					<button
						onclick={saveFtp}
						disabled={result.ftp === 0}
						class="rounded bg-white px-5 py-3 text-sm font-semibold text-black hover:bg-white/90 disabled:opacity-40"
						>Save {result.ftp} W as my FTP</button
					>
					<!-- Never silently change FTP: it moves every workout's difficulty. -->
					<a
						href="/profile"
						class="text-muted py-2 text-xs underline hover:text-white"
						>Keep my current {profile.current.ftp} W</a
					>
				{/if}
			</div>
		</div>
	{/if}
</main>
