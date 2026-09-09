<script lang="ts">
	import { canSimulate } from '$lib/ble/can-simulate';
	import { roomConnection } from '$lib/room/connection.svelte';
	import { createSoloTrainer } from '$lib/ride/solo-trainer.svelte';
	import { SimulatedTrainer } from '$lib/ble/simulated';
	import type { Trainer } from '$lib/ble/trainer';
	import { hrZoneOf, ZONE_TEXT, zoneOf } from '$lib/components/zones';
	import { formatClock } from '$lib/format';
	import { createRideSession } from '$lib/workout/session.svelte';
	import { play } from '$lib/sound/cues';
	import { byId } from '$lib/workout/library';
	import { createCustomStore } from '$lib/workout/custom.svelte';
	import { pushProfile } from '$lib/profile-sync.svelte';
	import { createProfileStore } from '$lib/profile.svelte';
	import { sensors } from '$lib/sensors.svelte';
	import { hwlog } from '$lib/ble/hwlog';
	import { apiBlob } from '$lib/api';
	import { uploadRide } from '$lib/ride/save';
	import { createHistoryStore, summarise } from '$lib/history.svelte';
	import { onDestroy } from 'svelte';
	import { guardLeaving } from '$lib/ride/leave-guard.svelte';
	import { page } from '$app/state';
	import { openRideBuffer, type RideBuffer } from '$lib/ride/buffer';
	import { createFlightRecorder } from '$lib/ride/flightrecorder.svelte';
	import PreRide from '$lib/ride/PreRide.svelte';
	import RideTv from '$lib/ride/RideTv.svelte';
	import RidingScreen from '$lib/ride/RidingScreen.svelte';
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
	// rider who corrects the number here does not find the old one on /settings/profile.
	const ftp = $derived(profile.current.ftp);
	let recorded = false;
	let session = $state<ReturnType<typeof createRideSession> | null>(null);
	let downloading = $state(false);
	let error = $state<string | null>(null);
	// The ride on the account, once it is: the summary's way forward (#1331).
	let savedId = $state<string | null>(null);

	// ?replay=<fixture> rides a committed capture instead of the generator
	// (#54): deterministic reproduction, the agent's screenshot instead of the
	// rider's.
	// WATTROOM.md: simulators are dev-flag equipment, and there is one gate for
	// that now (#1000). `?sim=1` is gone with it: it was a URL any rider could
	// type, and the e2e it existed for signs in through the dev door instead —
	// which the gate admits on the production BUILD CI rides.
	const replayName = $derived(
		canSimulate() ? page.url.searchParams.get('replay') : null,
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

	// Paired before the ride, not by starting it (#611): the paired-devices
	// grid below owns the trainer until Start hands it to the session.
	const solo = createSoloTrainer();

	async function begin(trainer: Trainer) {
		error = null;
		// One trainer, one rider (#521): the room now holds its BLE connection
		// for as long as you stand in it, so a solo ride has to take it back
		// rather than open a second control channel to the same hardware. A
		// trainer paired in the grid and then left for a simulated ride is the
		// same conflict on this page.
		roomConnection.current?.ride.unpair();
		if (solo.trainer && solo.trainer !== trainer) solo.forget();
		try {
			// Crash safety (#19): every recorded sample also lands in IndexedDB,
			// so a browser crash at minute 55 still has a ride to export.
			const startedAt = Date.now();
			buffer = await openRideBuffer({
				rideId: String(startedAt),
				startedAt,
				workoutName: workout.name,
				// Carried so a ride whose save failed can be saved from the
				// recovery card rather than only exported (#794).
				workoutJson: JSON.stringify(workout),
				ftp,
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
						watts: sample.watts,
						cadence: sample.cadence,
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
		const summary = summarise(current.recording);
		if (summary.seconds === 0) {
			buffer?.end();
			return;
		}
		const ended = buffer;
		void uploadRide({
			workoutName: workout.name,
			workoutJson: JSON.stringify(workout),
			startedAt: current.startedAt.toISOString(),
			samples: current.recording.map((sample) => ({
				watts: sample.watts,
				cadence: sample.cadence,
				hr: sample.heartRate,
			})),
		}).then((outcome) => {
			if ('saved' in outcome) {
				// The ride is on the account: NOW it stops being a ride to
				// recover. Ending the buffer before the server answered is
				// what used to make a failed save vanish (#794).
				ended?.end();
				savedId = outcome.saved.id || null;
				return;
			}
			const { failure } = outcome;
			// A refusal the server will repeat — under a minute — is not a
			// ride to recover either: offering it back would refuse it again
			// on every reload. Its summary still lands on the device below.
			if (failure.final) ended?.end();
			// Otherwise the buffer keeps every sample and stays unfinished, so
			// the ride is offered back below with a Save that retries this
			// POST. The local summary is the second copy, not the only one.
			const localFailure = history.add({
				id: `${current.startedAt.getTime()}`,
				workoutName: workout.name,
				startedAt: current.startedAt.toISOString(),
				execution: current.execution,
				ftp,
				...summary,
			});
			error =
				localFailure ??
				(failure.final
					? `${failure.message} Its summary stays on this device.`
					: `${failure.message} This ride is kept on this device — reload to save it from the recovery card.`);
		});
	});

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
	// confirm, only while the session is actually alive, and the browser's
	// unload guard for tab closes — shared with /ramp.
	guardLeaving(
		() => !!session && session.state !== 'done' && session.state !== 'idle',
		{
			title: 'End the ride and leave?',
			body: 'The summary and the .fit file are lost.',
			action: 'End the ride',
			cancel: 'Keep riding',
		},
	);
	// This page is the session's only owner: leaving it ends the ride, as the
	// confirm above promises — or the trainer holds a target with nobody
	// watching and the frame stays caved.
	onDestroy(() => session?.stop());
</script>

<svelte:head><title>{workout.name} · Ride · WattRoom</title></svelte:head>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (tv = false)} />

<!-- Mid-ride the whole frame is the cave, sidebar included (#113 refined,
     ADR-0020): the layout reads soloRide.active. Setup and the summary are
     desk surfaces, the effort itself gets the dark. -->
<main class="bg-surface text-ink flex min-h-screen flex-col px-6 py-5">
	{#if !session}
		<PreRide
			{workout}
			summary={selected.summary}
			{ftp}
			{solo}
			{replayName}
			{error}
			onStart={(trainer) => void begin(trainer)}
			onReplay={beginReplay}
			onFtp={async (next) => {
				error =
					profile.update({ ftp: next }) ??
					(await pushProfile({ ftpWatts: next }));
			}}
			onError={(message) => (error = message)}
		/>
	{:else if session.state !== 'done'}
		<RidingScreen
			{session}
			{workout}
			{ftp}
			{remaining}
			{watts}
			{target}
			{readouts}
			{bands}
			{signalLost}
			onFlag={() => recorder.flag()}
			onTv={() => (tv = true)}
		/>
	{/if}

	{#if session && session.state !== 'done' && tv}
		<!-- Solo TV (#126): the same truth at 3-metre size. -->
		<RideTv
			{session}
			{workout}
			{ftp}
			{remaining}
			{watts}
			{target}
			{zone}
			onExit={() => (tv = false)}
		/>
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
							<!-- The end links forward (#1331): the ride's own page first,
							     the export and the next workout after it. -->
							{#if savedId}
								<a href="/history/{savedId}" class="btn btn-primary"
									>See your ride</a
								>
							{/if}
							<button
								onclick={downloadFit}
								disabled={downloading}
								data-testid="download-fit"
								class="btn {savedId ? 'btn-secondary' : 'btn-primary'}"
								>{downloading ? 'Preparing…' : 'Export .fit'}</button
							>
							<a href="/workouts" class="btn btn-secondary"
								>Pick another workout</a
							>
						</div>
						{#if error}
							<p class="text-danger mt-2 text-xs">{error}</p>
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
