<script lang="ts">
	import Logo from '$lib/brand/Logo.svelte';
	import { FtmsTrainer } from '$lib/ble/ftms';
	import { SimulatedTrainer } from '$lib/ble/simulated';
	import type { Trainer } from '$lib/ble/trainer';
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import { formatClock, ZONE_TEXT, zoneOf } from '$lib/components/zones';
	import { durationSeconds } from '$lib/workout/engine';
	import {
		createRideSession,
		DEFAULTS,
		toleranceBand,
	} from '$lib/workout/session.svelte';
	import type { Workout } from '$lib/workout/types';
	import { play } from '$lib/sound/cues';
	import { byId } from '$lib/workout/library';
	import { createCustomStore } from '$lib/workout/custom.svelte';
	import { createProfileStore } from '$lib/profile.svelte';
	import { createHistoryStore, summarise } from '$lib/history.svelte';
	import { page } from '$app/state';

	// The library is the source of workouts now; ?w=<id> selects one, and the default
	// is the session most people ride.
	const custom = createCustomStore();
	const requested = page.url.searchParams.get('w') ?? '';
	const saved = custom.byId(requested);
	const selected = $derived(
		byId(requested) ??
			(saved
				? {
						id: saved.id,
						focus: 'Custom' as const,
						summary: 'Your own workout.',
						workout: saved.workout,
					}
				: byId('sweet-spot-2x20')!),
	);
	const workout = $derived(selected.workout);

	// FTP comes from the profile, set by hand or measured by a ramp test (#14).
	const profile = createProfileStore();
	const history = createHistoryStore();
	// The profile is FTP's only home — the field below writes through to it, so a
	// rider who corrects the number here does not find the old one on /profile.
	const ftp = $derived(profile.current.ftp);
	let recorded = false;
	let session = $state<ReturnType<typeof createRideSession> | null>(null);
	let downloading = $state(false);
	let error = $state<string | null>(null);

	const supported = typeof navigator !== 'undefined' && !!navigator.bluetooth;

	async function begin(trainer: Trainer) {
		error = null;
		try {
			const next = createRideSession({ trainer, workout, ftp });
			await next.start();
			session = next;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		}
	}

	// Sound announces block changes because the rider is not watching the screen.
	// Plain let, not $state: an effect that reads and writes its own state invalidates
	// itself. Nothing renders this, so it does not need to be reactive.
	let heardBlock: number | null = null;
	$effect(() => {
		const index = session?.info.segmentIndex;
		if (index === undefined) return;
		if (heardBlock !== null && index !== heardBlock) play('block');
		heardBlock = index;
	});

	// A finished ride is worth keeping even if the rider never exports it.
	$effect(() => {
		const current = session;
		if (!current || current.state !== 'done' || recorded) return;
		recorded = true;
		const summary = summarise(current.recording);
		if (summary.seconds === 0) return;
		error = history.add({
			id: `${current.startedAt.getTime()}`,
			workoutName: workout.name,
			startedAt: current.startedAt.toISOString(),
			execution: current.execution,
			ftp,
			...summary,
		});
	});

	const watts = $derived(session?.sample?.watts ?? 0);
	const target = $derived(session?.target ?? 0);
	const zone = $derived(zoneOf(watts, ftp));
	const band = $derived(target > 0 ? toleranceBand(target) : 0);
	const pct = (value: number) =>
		Math.min(100, Math.max(0, (value / ftp / 1.5) * 100));
	const remaining = $derived(session ? session.total - session.elapsed : 0);

	/** The server owns .fit encoding (muktihari/fit is Go); the client owns the ride. */
	async function downloadFit() {
		if (!session) return;
		downloading = true;
		error = null;
		try {
			const response = await fetch('/api/rides/export', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					startedAt: session.startedAt.toISOString(),
					samples: session.recording,
				}),
			});
			if (!response.ok) {
				const payload = await response.json().catch(() => null);
				throw new Error(payload?.message ?? 'The ride could not be exported.');
			}
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;
			link.download =
				response.headers
					.get('content-disposition')
					?.match(/filename="(.+)"/)?.[1] ?? 'ride.fit';
			link.click();
			URL.revokeObjectURL(url);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			downloading = false;
		}
	}
</script>

<main class="bg-surface flex min-h-screen flex-col px-6 py-5 text-white">
	{#if !session}
		<!-- Pre-ride: pick your effort level and how you are getting power in. -->
		<div class="m-auto w-full max-w-md text-center">
			<Logo size={56} />
			<h1 class="font-display mt-6 text-2xl font-bold">{workout.name}</h1>
			<p class="text-muted mt-2 text-sm">
				{formatClock(durationSeconds(workout))} · targets scale to your FTP
			</p>

			<p class="text-muted mt-4 text-xs">{selected.summary}</p>
			<a
				href="/workouts"
				class="text-muted mt-3 inline-block text-xs underline hover:text-white"
				>Choose a different workout</a
			>

			<label class="mt-6 block text-left">
				<span class="text-muted text-[10px] tracking-wider uppercase"
					>your FTP (watts)</span
				>
				<input
					type="number"
					value={ftp}
					onchange={(event) => {
						error = profile.update({
							ftp: Number(event.currentTarget.value),
						});
					}}
					min="80"
					max="500"
					class="border-muted/25 focus:border-muted/60 mt-1 w-full rounded border bg-transparent px-3 py-2 font-mono text-sm tabular-nums outline-none"
				/>
			</label>
			<a
				href="/ramp"
				class="text-muted mt-2 inline-block text-xs underline hover:text-white"
				>Measure it with a ramp test</a
			>

			{#if error}
				<p class="text-z6 mt-4 text-sm">{error}</p>
			{/if}

			<div class="mt-6 grid gap-2">
				<button
					onclick={() => begin(new FtmsTrainer())}
					disabled={!supported}
					class="rounded bg-white px-5 py-3 text-sm font-semibold text-black hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-40"
					>Pair trainer and start</button
				>
				<button
					onclick={() => begin(new SimulatedTrainer({ baseWatts: ftp * 0.8 }))}
					class="border-muted/30 hover:border-muted/60 rounded border px-5 py-3 text-sm"
					>Ride simulated</button
				>
			</div>
			{#if !supported}
				<p class="text-muted mt-3 text-xs">
					This browser has no Web Bluetooth — use Chrome or Edge to pair a real
					trainer.
				</p>
			{/if}
		</div>
	{:else}
		<header class="flex items-center gap-4">
			<Logo size={26} live={session.state === 'running'} />
			<div>
				<p class="font-display leading-tight font-bold">{workout.name}</p>
				<p class="text-muted text-xs">
					{session.info.segment?.kind ?? ''} · FTP {ftp} W
				</p>
			</div>
			<div class="ml-auto text-right">
				<div class="font-display text-2xl leading-none font-bold tabular-nums">
					{formatClock(remaining)}
				</div>
				<div class="text-muted text-[10px] tracking-wider uppercase">
					remaining
				</div>
			</div>
		</header>

		<!-- Ride-critical states are persistent status, never toasts (.claude/rules/errors.md). -->
		{#if session.state === 'autopaused'}
			<div class="border-z5/40 bg-z5/10 mt-4 rounded-lg border px-5 py-3">
				<p class="text-sm font-medium">Paused — you stopped pedalling</p>
				<p class="text-muted text-xs">
					Your targets are released and this time is excluded from your score.
					Start pedalling to pick up where you left off.
				</p>
			</div>
		{:else if session.state === 'resuming'}
			<div
				class="border-neon/40 bg-surface-raised mt-4 flex items-center gap-4 rounded-lg border px-5 py-3"
			>
				<span
					class="text-watt glow-text-strong font-display text-3xl font-bold tabular-nums"
					>{session.resumeIn}</span
				>
				<p class="text-sm">Picking back up — ease in.</p>
			</div>
		{:else if session.spiralActive}
			<div
				class="border-neon/40 bg-surface-raised mt-4 rounded-lg border px-5 py-3"
			>
				<p class="text-sm font-medium">Spiral guard</p>
				<p class="text-muted text-xs">
					Your cadence collapsed under the target, so it is released until you
					spin back up. This is deliberate, not a dropout.
				</p>
			</div>
		{/if}

		<!-- The number, and where it sits against the target. -->
		<section
			class="border-muted/15 bg-surface-raised mt-4 flex items-center gap-8 rounded-lg border px-6 py-5"
		>
			<div class="shrink-0">
				<span
					class="text-watt glow-text-strong font-display text-6xl leading-none font-bold tabular-nums"
					>{watts}</span
				>
				<span class="text-muted ml-1 text-sm">W</span>
			</div>
			<div class="flex-1">
				<div class="bg-surface relative h-8 overflow-hidden rounded">
					{#if target > 0}
						<div
							class="bg-neon/35 absolute inset-y-0"
							style="left: {pct(target - band)}%; width: {pct(target + band) -
								pct(target - band)}%"
						></div>
					{/if}
					<div
						class="bg-watt/70 absolute inset-y-0 left-0 transition-[width] duration-500 ease-out"
						style="width: {pct(watts)}%"
					></div>
					{#if target > 0}
						<div
							class="bg-neon absolute inset-y-0 w-0.5"
							style="left: {pct(target)}%"
						></div>
					{/if}
				</div>
				<div
					class="text-muted mt-1.5 flex justify-between font-mono text-[10px] tabular-nums"
				>
					<span>0</span>
					<span>{target > 0 ? `target ${target} W` : 'no target'}</span>
					<span>{Math.round(ftp * 1.5)}</span>
				</div>
			</div>
			<div class="shrink-0 text-right">
				<div
					class="font-display text-2xl leading-none font-semibold tabular-nums {ZONE_TEXT[
						zone
					]}"
				>
					Z{zone}
				</div>
				<div class="text-muted mt-1 text-[10px] tracking-wider uppercase">
					zone
				</div>
			</div>
		</section>

		<div class="mt-3 flex flex-wrap items-center gap-x-8 gap-y-3">
			{#each [{ label: 'rpm', value: session.sample?.cadence ?? 0 }, { label: 'block left', value: formatClock(session.info.secondsRemainingInSegment) }, { label: 'execution', value: `${Math.round(session.execution * 100)}%` }] as readout (readout.label)}
				<div>
					<span
						class="font-display text-xl leading-none font-semibold tabular-nums"
						>{readout.value}</span
					>
					<span class="text-muted ml-1 text-[10px] tracking-wider uppercase"
						>{readout.label}</span
					>
				</div>
			{/each}

			<!-- Rider controls: big targets, no precision needed (.claude/rules/ux.md). -->
			<div class="ml-auto flex items-center gap-2">
				<button
					onclick={() => session?.nudgeBias(-DEFAULTS.biasStep)}
					class="border-muted/25 hover:border-muted/60 h-11 w-11 rounded border text-lg"
					aria-label="Lower intensity">−</button
				>
				<div class="w-16 text-center">
					<div class="font-display text-sm leading-none font-bold tabular-nums">
						{Math.round(session.bias * 100)}%
					</div>
					<div class="text-muted text-[9px] tracking-wider uppercase">bias</div>
				</div>
				<button
					onclick={() => session?.nudgeBias(DEFAULTS.biasStep)}
					class="border-muted/25 hover:border-muted/60 h-11 w-11 rounded border text-lg"
					aria-label="Raise intensity">+</button
				>
				<button
					onclick={() => session?.extend(60)}
					class="border-muted/25 hover:border-muted/60 h-11 rounded border px-4 text-sm"
					>+1 min</button
				>
				<button
					onclick={() => session?.skip()}
					class="border-muted/25 hover:border-muted/60 h-11 rounded border px-4 text-sm"
					>Skip block</button
				>
			</div>
		</div>

		<div
			class="border-muted/15 bg-surface-raised mt-3 overflow-hidden rounded-lg border"
		>
			<IntervalGraph
				segments={session.segments}
				total={session.total}
				elapsed={session.elapsed}
				{ftp}
				trace={session.trace}
			/>
		</div>

		{#if session.state === 'done'}
			<div
				class="border-muted/15 bg-surface-raised mt-3 rounded-lg border px-5 py-4"
			>
				<p class="font-display font-bold">Session complete</p>
				<p class="text-muted mt-1 text-xs">
					Execution {Math.round(session.execution * 100)}% · {session.recording
						.length} seconds recorded.
				</p>
				<button
					onclick={downloadFit}
					disabled={downloading}
					data-testid="download-fit"
					class="mt-3 rounded bg-white px-4 py-2.5 text-sm font-medium text-black hover:bg-white/90 disabled:opacity-40"
					>{downloading ? 'Preparing…' : 'Download .fit'}</button
				>
				{#if error}
					<p class="text-z6 mt-2 text-xs">{error}</p>
				{/if}
			</div>
		{/if}
	{/if}
</main>
