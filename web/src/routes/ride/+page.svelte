<script lang="ts">
	import { canSimulate } from '$lib/ble/can-simulate';
	import { roomConnection } from '$lib/room/connection.svelte';
	import { createSoloTrainer } from '$lib/ride/solo-trainer.svelte';
	import { SimulatedTrainer } from '$lib/ble/simulated';
	import type { Trainer } from '$lib/ble/trainer';
	import {
		createRideSession,
		SIGNAL_LOST_MS,
	} from '$lib/workout/session.svelte';
	import { play } from '$lib/sound/cues';
	import { byId } from '$lib/workout/library';
	import { customWorkouts } from '$lib/workout/custom.svelte';
	import { pushProfile } from '$lib/profile-sync.svelte';
	import { createProfileStore } from '$lib/profile.svelte';
	import { sensors } from '$lib/sensors.svelte';
	import { hwlog } from '$lib/ble/hwlog';
	import { apiBlob } from '$lib/api';
	import { downloadBlob } from '$lib/download';
	import { uploadRide } from '$lib/ride/save';
	import { toasts } from '$lib/toast.svelte';
	import { createHistoryStore, summarise } from '$lib/history.svelte';
	import { onDestroy } from 'svelte';
	import { guardLeaving } from '$lib/ride/leave-guard.svelte';
	import { page } from '$app/state';
	import Banner from '$lib/components/Banner.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { openRideBuffer, type RideBuffer } from '$lib/ride/buffer';
	import { createFlightRecorder } from '$lib/ride/flightrecorder.svelte';
	import PreRide from '$lib/ride/PreRide.svelte';
	import TvOverlay from '$lib/room/TvOverlay.svelte';
	import RidingScreen from '$lib/ride/RidingScreen.svelte';
	import { describeBlock } from '$lib/room/view';
	import SessionSummary from '$lib/ride/SessionSummary.svelte';

	// The library is the source of workouts now; ?w=<id> selects one, and the default
	// is the session most people ride.
	const custom = customWorkouts();
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
	// A requested workout that is not built in waits for the shelf, and a
	// shelf that failed or does not hold it is said — the fallback used to
	// ride Sweet Spot 2×20 under a different name with no word (audit
	// 2026-09-09).
	const wanted = $derived(!!requested && !byId(requested));
	const shelfPending = $derived(wanted && !custom.loaded);
	const shelfMissing = $derived(wanted && custom.loaded && !saved);

	// FTP comes from the profile, set by hand or measured by a ramp test (#14).
	const profile = createProfileStore();
	const history = createHistoryStore();
	// The profile is FTP's only home — the field below writes through to it, so a
	// rider who corrects the number here does not find the old one on /settings/profile.
	const ftp = $derived(profile.current.ftp);
	let recorded = false;
	// Set once the page is gone: a save that answers after that has no
	// summary to land on, so its outcome becomes a toast (#1544).
	let gone = false;
	let saving = $state(false);
	let session = $state<ReturnType<typeof createRideSession> | null>(null);
	let downloading = $state(false);
	let error = $state<string | null>(null);
	// The save's outcome is persistent status (errors.md); an export or a
	// flag failing must not overwrite it (audit 2026-09-09).
	let saveStatus = $state<string | null>(null);
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
			});
			trainerName = trainer.name;
			recorder.event('ride', `starting ${workout.name}`);
			const next = createRideSession({
				trainer,
				workout,
				ftp,
				startedAt,
				readings: () => sensors.readings,
				// The rider's own sprint setup (#1529): a sprint block releases
				// the trainer to this slope, the way an armed sprint does in a
				// room. Read per sprint, so /settings lands mid-ride.
				sprint: () => ({
					grade: profile.current.sprintGrade,
					singleSpeed: profile.current.singleSpeed,
				}),
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
		if (session?.state === 'done') save(session);
	});
	// Called from the effect above and from onDestroy: the effect dies with
	// the component, and a ride ended by leaving the page used to reach the
	// account only if the rider later noticed the recovery card (audit
	// 2026-09-09).
	function save(current: ReturnType<typeof createRideSession>) {
		if (recorded) return;
		recorded = true;
		const summary = summarise(current.recording);
		if (summary.seconds === 0) {
			buffer?.end();
			// Not a summary of zeros with an export that 400s (#1544).
			saveStatus = 'Nothing was recorded — no watts reached the app.';
			return;
		}
		const ended = buffer;
		saving = true;
		void uploadRide({
			workoutName: workout.name,
			workoutJson: JSON.stringify(workout),
			startedAt: current.startedAt.toISOString(),
			samples: current.recording.map((sample) => ({
				watts: sample.watts,
				cadence: sample.cadence,
				hr: sample.heartRate,
				// The trim this second was ridden at (#1530): without it the
				// server re-scores the ride against the workout as written and
				// hands back an execution the rider never saw.
				bias: sample.bias,
			})),
		}).then((outcome) => {
			saving = false;
			if ('saved' in outcome) {
				// The ride is on the account: NOW it stops being a ride to
				// recover. Ending the buffer before the server answered is
				// what used to make a failed save vanish (#794).
				ended?.end();
				savedId = outcome.saved.id || null;
				if (gone)
					toasts.push('Ride saved to your history.', {
						href: savedId ? `/history/${savedId}` : undefined,
					});
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
				executionScored: current.scored,
				ftp,
				...summary,
			});
			saveStatus =
				localFailure ??
				(failure.final
					? `${failure.message} Its summary stays on this device.`
					: `${failure.message} This ride is kept on this device — reload to save it from the recovery card.`);
			// The page that would have shown this is gone (a ride ended by
			// leaving): the one surface left is a toast (errors.md).
			if (gone) toasts.push(saveStatus, { tone: 'error' });
		});
	}

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
			nowMs - session.sample.at > SIGNAL_LOST_MS,
	);

	// The block, derived once for both screens that draw it — the riding
	// surface and the TV (ADR-0046).
	const block = $derived(
		session && session.segments.length > 0
			? describeBlock(session.info, session.segments, workout, ftp)
			: null,
	);

	/**
	 * You, in the shape the TV renders (#1632). The room's TV takes a roster and
	 * a solo ride is a roster of one — which is the whole convergence: one TV
	 * screen, the tiles simply absent when nobody else is riding.
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
		stale: false,
		target: session?.target ?? 0,
		trace: session?.trace ?? [],
	});

	const watts = $derived(session?.sample?.watts ?? 0);
	const target = $derived(session?.target ?? 0);

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
					// fields, so anything else the recording grows — the bias
					// added for #1530 was the first — refuses the export outright.
					// `recovered.ts` has always mapped it this way; this was the
					// path passing the raw object.
					samples: session.recording.map((sample) => ({
						second: sample.second,
						watts: sample.watts,
						cadence: sample.cadence,
						heartRate: sample.heartRate,
					})),
				},
			});
			if (!res.ok) throw new Error(res.error.message);
			downloadBlob(res.data.blob, res.data.filename ?? 'ride.fit');
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
			body: 'The ride so far is saved to your account.',
			action: 'End the ride',
			cancel: 'Keep riding',
		},
	);
	// This page is the session's only owner: leaving it ends the ride, as the
	// confirm above promises — or the trainer holds a target with nobody
	// watching and the frame stays caved.
	onDestroy(() => {
		gone = true;
		if (!session) return;
		session.stop();
		save(session);
	});
</script>

<svelte:head
	><title
		>{shelfPending || shelfMissing ? 'Ride' : workout.name} · Ride · WattRoom</title
	></svelte:head
>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (tv = false)} />

<!-- Mid-ride the whole frame is the cave, sidebar included (#113 refined,
     ADR-0020): the layout reads soloRide.active. Setup and the summary are
     desk surfaces, the effort itself gets the dark. -->
<main class="bg-surface text-ink flex min-h-screen flex-col px-6 py-5">
	{#if !session}
		{#if shelfPending}
			<Skeleton class="h-8 w-56" />
			<Skeleton class="mt-6 h-48" />
		{:else if shelfMissing}
			<Banner tone="error">
				{custom.error ?? 'That workout is not on your shelf any more.'}
				{#snippet action()}
					{#if custom.error}
						<button onclick={() => custom.retry()} class="btn-link text-xs"
							>Retry</button
						>
					{:else}
						<a href="/workouts" class="btn-link text-xs">Open Workouts</a>
					{/if}
				{/snippet}
			</Banner>
		{:else}
			<PreRide
				{workout}
				summary={selected.summary}
				{ftp}
				{solo}
				{replayName}
				{error}
				onStart={(trainer) => void begin(trainer)}
				onReplay={beginReplay}
				onSaved={(ride) => history.remove(String(ride.startedAt))}
				onFtp={async (next) => {
					// The account first (#1543): the other order reported a
					// number the next boot pulled back over.
					error =
						(await pushProfile({ ftpWatts: next })) ??
						profile.update({ ftp: next });
				}}
				onError={(message) => (error = message)}
			/>
		{/if}
	{:else if session.state !== 'done'}
		<RidingScreen
			{session}
			{block}
			{workout}
			{ftp}
			kg={profile.current.kg}
			lthr={profile.current.lthr}
			{watts}
			{target}
			{signalLost}
			onFlag={() => recorder.flag()}
			onTv={() => (tv = true)}
		/>
	{/if}

	{#if session && session.state !== 'done' && tv}
		<!-- The room's TV, riding alone (#1632, ADR-0046): the same screen at
		     3 m, with the roster column absent because there is nobody in it. -->
		<TvOverlay
			riders={[tvRider]}
			segments={session.segments}
			total={session.total}
			elapsed={session.elapsed}
			{block}
			roomName={workout.name}
			workoutName={block?.label ?? ''}
			live
			onExit={() => (tv = false)}
		/>
	{/if}

	{#if session && session.state === 'done'}
		<!-- The ride is over: the summary IS the screen — no dead HUD glowing
		     zeros behind it (#126). -->
		<div class="mx-auto mt-4 w-full max-w-3xl">
			<SessionSummary
				title="Ride complete"
				subtitle="{workout.name} · {new Date().toLocaleDateString()}"
				samples={session.recording}
				ftp={profile.current.ftp}
				execution={session.scored ? session.execution : undefined}
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
							{:else if saving}
								<!-- The row keeps its shape while the save is in flight:
								     the button under the thumb never changes role (#1544). -->
								<button disabled class="btn btn-primary">Saving…</button>
							{/if}
							<button
								onclick={downloadFit}
								disabled={downloading || !session?.recording.length}
								data-testid="download-fit"
								class="btn {savedId || saving
									? 'btn-secondary'
									: 'btn-primary'}"
								>{downloading ? 'Preparing…' : 'Export .fit'}</button
							>
							<a href="/workouts" class="btn btn-secondary"
								>Pick another workout</a
							>
						</div>
						{#if saveStatus}
							<div class="mt-2"><Banner tone="warn">{saveStatus}</Banner></div>
						{/if}
						{#if error}
							<div class="mt-2"><Banner tone="error">{error}</Banner></div>
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
											aria-label="what went wrong"
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
