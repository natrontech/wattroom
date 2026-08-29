<script lang="ts">
	import { onDestroy } from 'svelte';
	import { createRoomLive } from '$lib/room/live.svelte';
	import { account } from '$lib/account.svelte';
	import { arbitrate } from '$lib/ble/arbitrate';
	import { FtmsTrainer } from '$lib/ble/ftms';
	import { SimulatedTrainer } from '$lib/ble/simulated';
	import type { Trainer } from '$lib/ble/trainer';
	import { sensors } from '$lib/sensors.svelte';
	import { formatClock, zoneOf } from '$lib/components/zones';
	import { createProfileStore } from '$lib/profile.svelte';
	import { flatten, targetAt } from '$lib/workout/engine';
	import { parseSharedSegments } from '$lib/room/workout';
	import { wireMetrics } from '$lib/room/wire';
	import { createRoomAv } from '$lib/room/av.svelte';
	import Jukebox from '$lib/room/Jukebox.svelte';
	import TvMode from '$lib/room/TvMode.svelte';
	import CheerLayer from '$lib/room/CheerLayer.svelte';
	import { library } from '$lib/workout/library';

	let { slug, role }: { slug: string; role: string } = $props();

	// Initial value on purpose: the page keys this component by slug, so a
	// different room mounts a fresh instance and a fresh socket.
	// svelte-ignore state_referenced_locally
	const live = createRoomLive(slug);
	// svelte-ignore state_referenced_locally
	const av = createRoomAv(slug);
	const profile = createProfileStore();
	onDestroy(() => {
		live.close();
		av.leave();
		stopRiding();
	});

	const canControl = $derived(role === 'owner' || role === 'coach');

	// Layouts (#22): a per-rider convenience, so localStorage, not the profile.
	type Layout = 'metrics' | 'video' | 'media';
	const LAYOUT_KEY = 'wattroom.layout.v1';
	let layout = $state<Layout>('metrics');
	let tv = $state(false);
	try {
		const stored = localStorage.getItem(LAYOUT_KEY);
		if (stored === 'video' || stored === 'media') layout = stored;
	} catch {
		/* default stands */
	}
	function setLayout(next: Layout) {
		layout = next;
		try {
			localStorage.setItem(LAYOUT_KEY, next);
		} catch {
			/* convenience only */
		}
	}
	const shared = $derived(live.tick?.state);
	const roster = $derived(live.tick?.roster ?? []);

	// ── Coach controls ────────────────────────────────────────────────────────
	let pickedId = $state(library[0].id);

	function pickAndStart() {
		const entry = library.find((w) => w.id === pickedId);
		if (!entry) return;
		const segments = flatten(entry.workout);
		const total = segments.reduce(
			(t, s) => Math.max(t, s.startSeconds + s.seconds),
			0,
		);
		live.control('pick', {
			name: entry.workout.name,
			json: JSON.stringify(entry.workout),
			totalSeconds: total,
		});
		live.control('start');
	}

	// ── Riding along ──────────────────────────────────────────────────────────
	// The shared timeline is the clock; each rider's trainer follows it at
	// their own FTP (SPEC: riders execute their own %FTP targets). Deliberately
	// not the solo RideSession — the server owns this clock, not the client.
	let trainer = $state<Trainer | null>(null);
	let rideError = $state<string | null>(null);
	/** Where my heart rate comes from right now — named on my tile (#62). */
	let hrSource = $state<'heart-rate' | 'trainer' | null>(null);
	let seq = 0;
	let unsubscribe: (() => void) | undefined;

	const segments = $derived(parseSharedSegments(shared?.workoutJson));

	const myTarget = $derived.by(() => {
		if (!shared || shared.phase !== 'running' || segments.length === 0)
			return 0;
		return (
			targetAt(segments, profile.current.ftp, shared.elapsed).targetWatts ?? 0
		);
	});

	// Target follows the shared timeline; released while paused or counting down.
	$effect(() => {
		if (trainer) void trainer.setTargetPower(myTarget);
	});

	async function ride(next: Trainer) {
		rideError = null;
		try {
			await next.connect();
			unsubscribe = next.onSample((sample) => {
				const metrics = arbitrate(
					{ trainer: sample, sensors: sensors.readings },
					sample.at,
				);
				hrSource =
					metrics.from.heartRate === 'heart-rate' ||
					metrics.from.heartRate === 'trainer'
						? metrics.from.heartRate
						: null;
				// ADR-0008 (#62): heart rate leaves this browser only while shared —
				// wireMetrics drops it at the door, per sample, so a mid-ride toggle
				// applies within a second and the rider's own .fit is untouched.
				live.sendMetrics(wireMetrics(metrics, profile.current.shareHr, ++seq));
			});
			trainer = next;
		} catch (cause) {
			rideError = cause instanceof Error ? cause.message : String(cause);
		}
	}

	function stopRiding() {
		live.finish();
		unsubscribe?.();
		void trainer?.setTargetPower(0);
		void trainer?.disconnect();
		trainer = null;
	}

	const bluetooth = typeof navigator !== 'undefined' && !!navigator.bluetooth;
	const pct = (watts: number, ftp: number) =>
		ftp > 0 ? Math.round((watts / ftp) * 100) : 0;
</script>

<section class="mt-8">
	<!-- Shared timeline: the room's one clock. -->
	<div
		class="border-muted/15 bg-surface-raised flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border px-5 py-4"
	>
		{#if live.status !== 'live'}
			<!-- Persistent status, not a toast: the rider is three meters away. -->
			<span class="text-z6 text-sm">
				{live.status === 'connecting'
					? 'Connecting…'
					: 'Connection lost — reconnecting…'}
			</span>
		{:else if !shared || shared.phase === 'idle'}
			<span class="text-muted text-sm">
				Lounge — {shared?.workoutName
					? `${shared.workoutName} is loaded.`
					: 'no workout picked yet.'}
			</span>
		{:else if shared.phase === 'countdown'}
			<span
				class="text-watt glow-text-strong font-display text-5xl font-bold tabular-nums"
				>{shared.countdownRemaining}</span
			>
			<span class="text-muted text-sm">{shared.workoutName} starts…</span>
		{:else}
			<span class="font-display text-3xl font-bold tabular-nums"
				>{formatClock(shared.elapsed)}</span
			>
			<span class="text-muted text-sm">
				/ {formatClock(shared.totalSeconds ?? 0)} · {shared.workoutName}
				{shared.phase === 'paused' ? '· paused' : ''}
				{shared.phase === 'done' ? '· done' : ''}
			</span>
		{/if}

		{#if canControl && shared}
			<div class="ml-auto flex flex-wrap items-center gap-2">
				{#if shared.phase === 'idle' || shared.phase === 'done'}
					<select
						bind:value={pickedId}
						class="border-muted/25 bg-surface rounded border px-2 py-1.5 text-sm"
					>
						{#each library as entry (entry.id)}
							<option value={entry.id}>{entry.workout.name}</option>
						{/each}
					</select>
					<button
						onclick={pickAndStart}
						class="rounded bg-white px-4 py-1.5 text-sm font-semibold text-black hover:bg-white/90"
						>Start</button
					>
				{:else if shared.phase === 'running'}
					<button
						onclick={() => live.control('pause')}
						class="border-muted/30 hover:border-muted/60 rounded border px-3 py-1.5 text-sm"
						>Pause</button
					>
					<button
						onclick={() => live.control('end')}
						class="border-z6/40 text-z6 hover:bg-z6/10 rounded border px-3 py-1.5 text-sm"
						>End</button
					>
				{:else if shared.phase === 'paused'}
					<button
						onclick={() => live.control('resume')}
						class="rounded bg-white px-4 py-1.5 text-sm font-semibold text-black hover:bg-white/90"
						>Resume</button
					>
					<button
						onclick={() => live.control('end')}
						class="border-z6/40 text-z6 hover:bg-z6/10 rounded border px-3 py-1.5 text-sm"
						>End</button
					>
				{/if}
			</div>
		{/if}
	</div>

	{#if live.refusal}
		<p class="text-muted mt-2 text-xs">{live.refusal}</p>
	{/if}

	<!-- The call. AV is transit-only, never recorded; chrome stays quiet. -->
	<div class="mt-3 flex flex-wrap items-center gap-2">
		{#if av.status === 'off' || av.status === 'failed'}
			<button
				onclick={() => av.join()}
				class="border-muted/30 hover:border-muted/60 rounded border px-4 py-2 text-sm"
				>Join voice</button
			>
			{#if av.error}<span class="text-muted text-xs">{av.error}</span>{/if}
		{:else if av.status === 'connecting'}
			<span class="text-muted text-sm">Joining the call…</span>
		{:else}
			<button
				onclick={() => av.toggleMic()}
				class="rounded border px-4 py-2 text-sm {av.micOn
					? 'border-muted/60'
					: 'border-z6/40 text-z6'}">{av.micOn ? 'Mute' : 'Unmute'}</button
			>
			<button
				onclick={() => av.toggleCam()}
				class="border-muted/30 hover:border-muted/60 rounded border px-4 py-2 text-sm"
				>{av.camOn ? 'Camera off' : 'Camera on'}</button
			>
			<button
				onclick={() => av.toggleShare()}
				class="border-muted/30 hover:border-muted/60 rounded border px-4 py-2 text-sm"
				>{av.sharing ? 'Stop sharing' : 'Share screen'}</button
			>
			<button
				onclick={() => av.leave()}
				class="text-muted text-xs underline hover:text-white"
				>leave voice</button
			>
		{/if}
	</div>

	<div class="text-muted mt-3 flex items-center gap-1 text-xs">
		{#each [{ id: 'metrics', label: 'Metrics' }, { id: 'video', label: 'Video' }, { id: 'media', label: 'Media' }] as option (option.id)}
			<button
				onclick={() => setLayout(option.id as Layout)}
				class="rounded px-2.5 py-1 {layout === option.id
					? 'bg-surface-raised text-white'
					: 'hover:text-white'}">{option.label}</button
			>
		{/each}
		<button
			onclick={() => (tv = true)}
			class="ml-auto underline hover:text-white">TV mode</button
		>
	</div>

	<Jukebox
		jukebox={live.tick?.jukebox}
		send={(action, videoId, title) => live.jukebox(action, videoId, title)}
		large={layout === 'media'}
		ducked={Object.entries(av.speaking).some(
			([id, active]) => active && id !== account.me?.id,
		)}
	/>

	<!-- Rider tiles: live data glows, chrome stays quiet. Layouts change the
	     grid, never the content — one tile markup, three densities. -->
	<div
		class="mt-4 grid gap-3 {layout === 'video'
			? 'sm:grid-cols-2'
			: layout === 'media'
				? 'sm:grid-cols-3 lg:grid-cols-4'
				: 'sm:grid-cols-2 lg:grid-cols-3'}"
	>
		{#each roster as rider (rider.id)}
			{@const metrics = live.tick?.riders?.[rider.id]}
			{@const zone = metrics ? zoneOf(metrics.watts, rider.ftpWatts) : 0}
			<div
				class="bg-surface-raised rounded-lg border p-4 {av.speaking[rider.id]
					? 'border-z4/60'
					: 'border-muted/15'}"
			>
				{#if av.videoOf[rider.id]}
					{#key av.videoOf[rider.id]}
						<div
							class="mb-3 aspect-video overflow-hidden rounded bg-black/40"
							{@attach (node) => av.attach(rider.id, node)}
						></div>
					{/key}
				{/if}
				<div class="flex items-baseline gap-2">
					<span class="font-display font-bold">{rider.name}</span>
					{#if rider.role !== 'member'}
						<span class="text-muted text-[10px] tracking-wider uppercase"
							>{rider.role}</span
						>
					{/if}
					{#if rider.id === account.me?.id && trainer}
						<button
							onclick={stopRiding}
							class="text-muted ml-auto text-[10px] underline hover:text-white"
							>stop</button
						>
					{/if}
				</div>
				{#if rider.id === account.me?.id && trainer && hrSource}
					<!-- Health data being broadcast is never something a rider should
					     have to discover (#62, ADR-0008): named source, one-tap stop. -->
					<p class="text-muted mt-1 text-[10px]">
						{#if profile.current.shareHr}
							Sharing heart rate from your {hrSource === 'heart-rate'
								? 'strap'
								: 'trainer'} ·
							<button
								onclick={() => profile.update({ shareHr: false })}
								class="underline hover:text-white">stop sharing</button
							>
						{:else}
							Heart rate not shared with this room ·
							<button
								onclick={() => profile.update({ shareHr: true })}
								class="underline hover:text-white">share</button
							>
						{/if}
					</p>
				{/if}
				{#if metrics}
					<div class="mt-2 flex items-baseline gap-2">
						<span
							class="text-watt glow-text font-display text-4xl leading-none font-bold tabular-nums"
							>{metrics.watts}</span
						>
						<span class="text-muted text-sm">W</span>
						<span
							class="font-display ml-auto text-lg font-semibold tabular-nums"
							>{pct(metrics.watts, rider.ftpWatts)}%</span
						>
					</div>
					<p class="text-muted mt-1 font-mono text-[11px] tabular-nums">
						Z{zone}
						{#if metrics.cadence}· {metrics.cadence} rpm{/if}
						{#if metrics.hr}· {metrics.hr} bpm{/if}
					</p>
				{:else}
					<p class="text-muted mt-3 text-xs">here, not riding</p>
				{/if}
			</div>
		{/each}
	</div>

	{#if !trainer}
		<div class="mt-4 flex flex-wrap items-center gap-2">
			<button
				onclick={() => ride(new FtmsTrainer())}
				disabled={!bluetooth}
				class="rounded bg-white px-4 py-2.5 text-sm font-medium text-black hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-40"
				>Pair trainer and ride</button
			>
			<button
				onclick={() =>
					ride(new SimulatedTrainer({ baseWatts: profile.current.ftp * 0.75 }))}
				class="border-muted/30 hover:border-muted/60 rounded border px-4 py-2.5 text-sm"
				>Ride simulated</button
			>
			{#if rideError}<span class="text-z6 text-xs">{rideError}</span>{/if}
		</div>
	{/if}
	<!-- Huge tap targets — used mid-ride, sweating. -->
	<div class="mt-4 flex gap-2">
		{#each ['🔥', '💪', '👏', '💀', '🚀', '🧊'] as emoji (emoji)}
			<button
				onclick={() => live.cheer(emoji)}
				class="border-muted/20 active:bg-surface-raised flex-1 rounded-lg border py-3 text-2xl sm:flex-none sm:px-5"
				>{emoji}</button
			>
		{/each}
	</div>

	<CheerLayer cheers={live.tick?.cheers} />

	{#if tv}
		<TvMode
			roster={live.tick?.roster ?? []}
			riders={live.tick?.riders ?? {}}
			{shared}
			exit={() => (tv = false)}
		/>
	{/if}
</section>
