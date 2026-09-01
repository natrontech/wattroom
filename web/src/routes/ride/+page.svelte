<script lang="ts">
	import Instrument from '$lib/room/Instrument.svelte';
	import Logo from '$lib/brand/Logo.svelte';
	import { FtmsTrainer } from '$lib/ble/ftms';
	import { SimulatedTrainer } from '$lib/ble/simulated';
	import type { Trainer } from '$lib/ble/trainer';
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import { hrZoneOf, ZONE_TEXT, zoneOf } from '$lib/components/zones';
	import { formatClock } from '$lib/format';
	import { durationSeconds, flatten } from '$lib/workout/engine';
	import {
		createRideSession,
		DEFAULTS,
		toleranceBand,
	} from '$lib/workout/session.svelte';
	import type { Workout } from '$lib/workout/types';
	import { play } from '$lib/sound/cues';
	import { byId } from '$lib/workout/library';
	import { createCustomStore } from '$lib/workout/custom.svelte';
	import { pushProfile } from '$lib/profile-sync.svelte';
	import { createProfileStore } from '$lib/profile.svelte';
	import { sensors } from '$lib/sensors.svelte';
	import { hwlog } from '$lib/ble/hwlog';
	import { api, apiBlob } from '$lib/api';
	import Banner from '$lib/components/Banner.svelte';
	import { createHistoryStore, summarise } from '$lib/history.svelte';
	import { dev } from '$app/environment';
	import { beforeNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import {
		discardRide,
		openRideBuffer,
		unfinishedRides,
		type RideBuffer,
	} from '$lib/ride/buffer';
	import { createFlightRecorder } from '$lib/ride/flightrecorder.svelte';
	import SessionSummary from '$lib/ride/SessionSummary.svelte';

	// The library is the source of workouts now; ?w=<id> selects one, and the default
	// is the session most people ride.
	const custom = createCustomStore();
	const requested = page.url.searchParams.get('w') ?? '';
	// Derived, not once: the shelf loads async — read at init it is always
	// empty, and every custom ride silently fell back to the default.
	const saved = $derived(custom.byId(requested));
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

	// ?replay=<fixture> rides a committed capture instead of the generator
	// (#54): deterministic reproduction, the agent's screenshot instead of the
	// rider's.
	// WATTROOM.md: simulators are dev-flag equipment. ?sim=1 is the escape the
	// e2e needs — it rides the production build (fake watts in a ROOM stay
	// dev-only; solo they only ever reach your own history).
	const simAllowed = $derived(dev || page.url.searchParams.has('sim'));
	const replayName = $derived(
		simAllowed ? page.url.searchParams.get('replay') : null,
	);
	async function beginReplay() {
		error = null;
		try {
			const res = await fetch(`/fixtures/${replayName}.json`);
			if (!res.ok) throw new Error(`No fixture named ${replayName}.`);
			const fixture = await res.json();
			await begin(new SimulatedTrainer({ replay: fixture.samples }));
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		}
	}

	let buffer: RideBuffer | undefined;
	const recorder = createFlightRecorder();
	let flagNotice = $state(false);
	let tv = $state(false);
	let sentFlags = $state(0);
	let sending = $state(false);

	async function sendFlags() {
		if (!session) return;
		sending = true;
		for (const flag of recorder.flags.slice(sentFlags)) {
			const res = await recorder.submit(flag, {
				route: '/ride',
				trainer: trainerName,
			});
			if (res.ok) sentFlags++;
			else {
				error = res.error.message;
				break;
			}
		}
		sending = false;
	}
	let trainerName = $state('simulated');

	async function begin(trainer: Trainer) {
		error = null;
		try {
			// Crash safety (#19): every recorded sample also lands in IndexedDB,
			// so a browser crash at minute 55 still has a ride to export.
			const startedAt = Date.now();
			buffer = await openRideBuffer({
				rideId: String(startedAt),
				startedAt,
				workoutName: workout.name,
			});
			trainerName = trainer.name;
			recorder.event('ride', `starting ${workout.name}`);
			const next = createRideSession({
				trainer,
				workout,
				ftp,
				readings: () => sensors.readings,
				onRecord: (sample) => {
					buffer?.append({ ...sample, seq: sample.second + 1, at: Date.now() });
					recorder.tick({
						...sample,
						target: session?.target ?? 0,
						state: session?.state ?? '',
					});
				},
			});
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

	// Guard telemetry for #46: the hardware session has to produce evidence, not
	// an anecdote. Dev-only via hwlog; plain lets, same reasoning as heardBlock.
	let sawSpiral = false;
	let sawState: string | null = null;
	$effect(() => {
		const current = session;
		if (!current) return;
		if (current.spiralActive !== sawSpiral) {
			sawSpiral = current.spiralActive;
			hwlog('spiral-guard', {
				active: sawSpiral,
				watts: current.sample?.watts,
				cadence: current.sample?.cadence,
				target: current.target,
				elapsed: current.elapsed,
			});
		}
		if (current.state !== sawState) {
			sawState = current.state;
			hwlog('ride-state', { state: sawState, elapsed: current.elapsed });
		}
	});

	// A finished ride is worth keeping even if the rider never exports it —
	// on the account (#110, one history feeding streaks and XP), with the
	// device store as the fallback when the server is unreachable.
	$effect(() => {
		const current = session;
		if (!current || current.state !== 'done' || recorded) return;
		recorded = true;
		buffer?.end();
		const summary = summarise(current.recording);
		if (summary.seconds === 0) return;
		void api('/api/rides', {
			method: 'POST',
			json: {
				workoutName: workout.name,
				workoutJson: JSON.stringify(workout),
				startedAt: current.startedAt.toISOString(),
				samples: current.recording.map((sample) => ({
					watts: sample.watts,
					cadence: sample.cadence,
					hr: sample.heartRate,
				})),
			},
		}).then((res) => {
			if (res.ok) return;
			error = history.add({
				id: `${current.startedAt.getTime()}`,
				workoutName: workout.name,
				startedAt: current.startedAt.toISOString(),
				execution: current.execution,
				ftp,
				...summary,
			});
		});
	});

	// A ride that never ended is a crash to offer back, not to silently keep.
	let recoverable = $state<Awaited<ReturnType<typeof unfinishedRides>>>([]);
	let recovering = $state(false);
	void unfinishedRides().then((rides) => (recoverable = rides));

	async function downloadRecovered(ride: (typeof recoverable)[number]) {
		recovering = true;
		error = null;
		try {
			const res = await apiBlob('/api/rides/export', {
				method: 'POST',
				json: {
					startedAt: new Date(ride.startedAt).toISOString(),
					samples: ride.samples.map((sample, index) => ({
						second: index,
						watts: sample.watts,
						cadence: sample.cadence,
						heartRate: sample.heartRate,
					})),
				},
			});
			if (!res.ok) throw new Error(res.error.message);
			const url = URL.createObjectURL(res.data.blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `wattroom-recovered-${new Date(ride.startedAt).toISOString().slice(0, 10)}.fit`;
			a.click();
			URL.revokeObjectURL(url);
			await discardRide(ride.rideId);
			recoverable = recoverable.filter((r) => r.rideId !== ride.rideId);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			recovering = false;
		}
	}

	async function discardRecovered(rideId: string) {
		await discardRide(rideId);
		recoverable = recoverable.filter((r) => r.rideId !== rideId);
	}

	const pairedCount = $derived(
		sensors.all.filter((s) => s.status === 'connected').length,
	);

	// bpm appears only when something is actually reporting it. A permanent "-- bpm"
	// cell is worse than no cell: it reads as a broken strap rather than no strap.
	const readouts = $derived([
		{ label: 'rpm', value: String(session?.sample?.cadence ?? 0), tone: '' },
		...(session?.sample?.heartRate !== undefined
			? [
					{
						label: 'bpm',
						value: String(session.sample.heartRate),
						// Own bpm coloured by HR zone once an LTHR anchors them (ADR-0014).
						tone: ZONE_TEXT[
							hrZoneOf(session.sample.heartRate, profile.current.lthr)
						],
					},
				]
			: []),
		{
			label: 'block left',
			value: formatClock(session?.info.secondsRemainingInSegment ?? 0),
			tone: '',
		},
		{
			label: 'execution',
			value: `${Math.round((session?.execution ?? 1) * 100)}%`,
			tone: '',
		},
	]);
	// Cadence and HR bands of the current block (#66/#67) — display-only.
	const stepBand = (
		low: number | undefined,
		high: number | undefined,
		unit: string,
		value: number,
	) => {
		const text =
			low !== undefined && high !== undefined
				? `${low}–${high} ${unit}`
				: high !== undefined
					? `under ${high} ${unit}`
					: low !== undefined
						? `over ${low} ${unit}`
						: null;
		if (!text) return null;
		const inBand =
			value > 0 &&
			(low === undefined || value >= low) &&
			(high === undefined || value <= high);
		return { text, inBand };
	};
	const bands = $derived.by(() => {
		const seg = session?.info.segment;
		if (!seg) return [];
		return [
			stepBand(
				seg.cadenceLow,
				seg.cadenceHigh,
				'rpm',
				session?.sample?.cadence ?? 0,
			),
			stepBand(seg.hrLow, seg.hrHigh, 'bpm', session?.sample?.heartRate ?? 0),
		].filter((band) => band !== null);
	});

	// A frozen number is worse than a warning: past 3 s without a sample the
	// dashboard says so, persistently, while the driver reconnects (#37).
	let nowMs = $state(Date.now());
	$effect(() => {
		const id = setInterval(() => (nowMs = Date.now()), 1000);
		return () => clearInterval(id);
	});
	const signalLost = $derived(
		!!session &&
			session.state !== 'done' &&
			!!session.sample &&
			nowMs - session.sample.at > 3000,
	);

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
			const res = await apiBlob('/api/rides/export', {
				method: 'POST',
				json: {
					startedAt: session.startedAt.toISOString(),
					samples: session.recording,
				},
			});
			if (!res.ok) throw new Error(res.error.message);
			const url = URL.createObjectURL(res.data.blob);
			const link = document.createElement('a');
			link.href = url;
			link.download = res.data.filename ?? 'ride.fit';
			link.click();
			URL.revokeObjectURL(url);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			downloading = false;
		}
	}
	// A stray tap on the rail mid-ride must not eat the ride (#126): one
	// confirm, only while the session is actually alive. The browser-level
	// unload guard rides along for tab closes.
	const riding = () =>
		!!session && session.state !== 'done' && session.state !== 'idle';
	beforeNavigate((navigation) => {
		if (
			riding() &&
			navigation.type !== 'leave' &&
			!confirm('End the ride and leave? The summary and .fit are lost.')
		) {
			navigation.cancel();
		}
	});
	$effect(() => {
		const handler = (event: BeforeUnloadEvent) => {
			if (riding()) event.preventDefault();
		};
		window.addEventListener('beforeunload', handler);
		return () => window.removeEventListener('beforeunload', handler);
	});
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (tv = false)} />

<!-- Mid-ride the solo player is the cave too (#113 refined): setup and the
     summary are desk surfaces, the effort itself gets the dark. -->
<main
	class="bg-surface text-ink flex min-h-screen flex-col px-6 py-5 {session &&
	session.state !== 'done'
		? 'cave'
		: ''}"
>
	{#if !session}
		<!-- Pre-ride: pick your effort level and how you are getting power in. -->
		<div class="m-auto w-full max-w-md text-center">
			<Logo size={56} />
			<h1 class="font-display mt-6 text-2xl font-bold">{workout.name}</h1>
			<p class="text-muted mt-2 text-sm">
				{formatClock(durationSeconds(workout))} · targets scale to your FTP
			</p>

			<p class="text-muted mt-4 text-xs">{selected.summary}</p>

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

			<label class="mt-6 block text-left">
				<span class="eyebrow">your FTP (watts)</span>
				<input
					type="number"
					value={ftp}
					onchange={async (event) => {
						const next = Number(event.currentTarget.value);
						error =
							profile.update({ ftp: next }) ??
							(await pushProfile({ ftpWatts: next }));
					}}
					min="80"
					max="500"
					class="input mt-1 w-full font-mono tabular-nums"
				/>
			</label>
			<a
				href="/ramp"
				class="text-muted hover:text-ink mt-2 inline-block text-xs underline"
				>Measure it with a ramp test</a
			>
			<a
				href="/pair"
				class="text-muted hover:text-ink mt-2 block text-xs underline"
				>{pairedCount > 0
					? `${pairedCount} sensor${pairedCount > 1 ? 's' : ''} paired`
					: 'Pair a heart rate strap or power meter'}</a
			>

			{#if recoverable.length > 0}
				{#each recoverable as ride (ride.rideId)}
					<div
						class="border-z4/40 bg-z4/10 mt-6 rounded-lg border px-4 py-3 text-left text-sm"
					>
						<p>
							Recovered an unfinished ride — {ride.workoutName},
							{new Date(ride.startedAt).toLocaleString()},
							{Math.round(ride.samples.length / 60)} min recorded.
						</p>
						<div class="mt-2 flex gap-2">
							<button
								onclick={() => downloadRecovered(ride)}
								disabled={recovering}
								class="btn btn-primary btn-xs">Download .fit</button
							>
							<button
								onclick={() => discardRecovered(ride.rideId)}
								class="btn btn-secondary btn-xs">Discard</button
							>
						</div>
					</div>
				{/each}
			{/if}

			{#if error}
				<p class="text-z6 mt-4 text-sm">{error}</p>
			{/if}

			<div class="mt-6 grid gap-2">
				<button
					onclick={() => begin(new FtmsTrainer())}
					disabled={!supported}
					class="btn btn-primary btn-lg">Pair trainer and start</button
				>
				{#if replayName}
					<button
						onclick={beginReplay}
						data-testid="ride-replay"
						class="btn btn-accent btn-lg">Replay {replayName}</button
					>
				{/if}
				{#if simAllowed}
					<button
						onclick={() =>
							begin(new SimulatedTrainer({ baseWatts: ftp * 0.8 }))}
						class="btn btn-secondary btn-lg">Ride simulated</button
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
	{:else if session.state !== 'done'}
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
				<div class="eyebrow">remaining</div>
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

		<!-- The same instrument the room uses (ADR-0020, #386). These were two
		     designs for one activity: a number beside a bar here, a needle over
		     a tolerance band there. The number travels with your power now, so
		     "left or right of the bright slot" reads before any digit does. -->
		<section class="mt-4">
			<Instrument {watts} {target} {ftp} />
			{#if bands.length > 0}
				<p class="text-muted mt-2 text-center text-xs">
					{#each bands as b (b.text)}
						<!-- The band is this block's point; colour answers "am I doing it". -->
						<span class="{b.inBand ? 'text-z4' : 'text-z5'} font-semibold"
							>at {b.text}</span
						>
					{/each}
				</p>
			{/if}
		</section>

		<div class="mt-3 flex flex-wrap items-center gap-x-8 gap-y-3">
			{#each readouts as readout (readout.label)}
				<div>
					<span
						class="font-display text-xl leading-none font-semibold tabular-nums {readout.tone}"
						>{readout.value}</span
					>
					<span class="eyebrow ml-1">{readout.label}</span>
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
					<div class="eyebrow">bias</div>
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
				<button
					onclick={() => (tv = true)}
					class="border-muted/25 text-muted hover:border-muted/60 hover:text-ink h-11 rounded border px-4 text-sm"
					>TV</button
				>
				<button
					onclick={() => session?.stop()}
					class="border-muted/25 text-muted hover:border-muted/60 hover:text-ink h-11 rounded border px-4 text-sm"
					>End ride</button
				>
				<!-- The ⚑ (#52): one tap, no dialog, keep pedalling. -->
				<button
					onclick={() => {
						recorder.flag();
						flagNotice = true;
						setTimeout(() => (flagNotice = false), 4000);
					}}
					class="border-watt/40 text-watt hover:bg-watt/10 h-11 rounded border px-5 text-lg"
					aria-label="Flag a problem">⚑</button
				>
			</div>
			{#if signalLost}
				<div class="mt-2">
					<Banner tone="error"
						>Trainer signal lost — reconnecting. Keep pedalling; your targets
						resume the moment it is back.</Banner
					>
				</div>
			{/if}
			{#if flagNotice}
				<!-- Consent in plain words, at the moment of the tap, never blocking. -->
				<p class="text-muted mt-2 text-xs">
					Flagged — after the ride this sends your last two minutes of ride data
					and logs to the developers. Only yours, nobody else's.
				</p>
			{/if}
		</div>

		<div class="panel mt-3 overflow-hidden">
			<IntervalGraph
				segments={session.segments}
				total={session.total}
				elapsed={session.elapsed}
				{ftp}
				trace={session.trace}
			/>
		</div>
	{/if}

	{#if session && session.state !== 'done' && tv}
		<!-- Solo TV (#126): the same truth at 3-metre size, vh-scaled like the
		     room's TV mode. -->
		<div class="bg-surface fixed inset-0 z-50 flex flex-col px-[3vw] py-[3vh]">
			<button
				onclick={() => (tv = false)}
				class="border-muted/30 text-muted hover:text-ink absolute bottom-4 left-4 rounded border px-3 py-1.5 text-xs"
				>Exit TV (esc)</button
			>
			<header class="flex items-baseline gap-[2vw]">
				<h2 class="font-display text-[3.2vh] leading-none font-bold">
					{workout.name}
				</h2>
				<span
					class="font-display ml-auto text-[6vh] leading-none font-bold tabular-nums"
					>{formatClock(remaining)}</span
				>
			</header>
			<div class="flex flex-1 flex-col items-center justify-center">
				<div>
					<span
						class="text-watt glow-text-strong font-display text-[18vh] leading-none font-bold tabular-nums"
						>{watts}</span
					>
					<span class="text-muted ml-2 text-[3vh]">W</span>
				</div>
				<div
					class="text-muted mt-[2vh] flex items-baseline gap-[2vw] text-[3vh]"
				>
					<span>{target > 0 ? `target ${target} W` : 'no target'}</span>
					<span class="font-display font-bold {ZONE_TEXT[zone]}">Z{zone}</span>
				</div>
			</div>
			<div class="overflow-hidden rounded-lg">
				<IntervalGraph
					segments={session.segments}
					total={session.total}
					elapsed={session.elapsed}
					{ftp}
					trace={session.trace}
				/>
			</div>
		</div>
	{/if}

	{#if session && session.state === 'done'}
		<!-- The ride is over: the summary IS the screen — no dead HUD glowing
		     zeros behind it (#126). -->
		<div class="mx-auto mt-4 w-full max-w-3xl">
			<SessionSummary
				subtitle="{workout.name} · {new Date().toLocaleDateString()}"
				samples={session.recording}
				ftp={profile.current.ftp}
				execution={session.execution}
			>
				{#snippet actions()}
					<div class="panel px-5 py-4">
						<div class="flex flex-wrap items-center gap-2">
							<button
								onclick={downloadFit}
								disabled={downloading}
								data-testid="download-fit"
								class="btn btn-primary"
								>{downloading ? 'Preparing…' : 'Export .fit'}</button
							>
							<a href="/workouts" class="btn btn-secondary"
								>Pick another workout</a
							>
						</div>
						{#if error}
							<p class="text-z6 mt-2 text-xs">{error}</p>
						{/if}

						{#if recorder.flags.length > sentFlags}
							<div class="border-muted/15 mt-4 grid gap-2 border-t pt-3">
								<span class="eyebrow">your flags</span>
								{#each recorder.flags.slice(sentFlags) as flag (flag.clientMs)}
									<div class="flex items-center gap-2">
										<span class="text-muted font-mono text-xs"
											>{new Date(flag.clientMs).toLocaleTimeString()}</span
										>
										<input
											bind:value={flag.note}
											placeholder="what went wrong? (optional)"
											class="input input-xs min-w-0 flex-1"
										/>
									</div>
								{/each}
								<button
									onclick={sendFlags}
									disabled={sending}
									class="btn btn-secondary justify-self-start"
									>{sending ? 'Sending…' : 'Send to the developers'}</button
								>
							</div>
						{:else if sentFlags > 0}
							<p class="text-z4 mt-3 text-xs">
								Thanks — {sentFlags} flag{sentFlags > 1 ? 's' : ''} sent.
							</p>
						{/if}
					</div>
				{/snippet}
			</SessionSummary>
		</div>
	{/if}
</main>
