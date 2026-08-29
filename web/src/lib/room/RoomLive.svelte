<script lang="ts">
	import { onDestroy } from 'svelte';
	import { play, setDucked } from '$lib/sound/cues';
	import { account } from '$lib/account.svelte';
	import { api } from '$lib/api';
	import { arbitrate } from '$lib/ble/arbitrate';
	import { FtmsTrainer } from '$lib/ble/ftms';
	import { SimulatedTrainer } from '$lib/ble/simulated';
	import type { Trainer } from '$lib/ble/trainer';
	import { sensors } from '$lib/sensors.svelte';
	import { formatClock } from '$lib/components/zones';
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import { createProfileStore } from '$lib/profile.svelte';
	import { flatten, targetAt } from '$lib/workout/engine';
	import { library } from '$lib/workout/library';
	import { createRoomLive } from '$lib/room/live.svelte';
	import { createRoomAv } from '$lib/room/av.svelte';
	import { parseSharedSegments, parseSharedWorkout } from '$lib/room/workout';
	import { addYouTubeUrl } from '$lib/room/jukebox-add';
	import { wireMetrics } from '$lib/room/wire';
	import {
		describeBlock,
		TILE_METRICS,
		type RoomRider,
		type TileMetric,
	} from '$lib/room/view';
	import type { RailRoom } from '$lib/room/mockcompat';
	import CheerLayer from '$lib/room/CheerLayer.svelte';
	import ExecutionMeter from '$lib/room/ExecutionMeter.svelte';
	import FaultBanner from '$lib/room/FaultBanner.svelte';
	import GamePanel from '$lib/room/GamePanel.svelte';
	import IntervalStrip from '$lib/room/IntervalStrip.svelte';
	import Jukebox from '$lib/room/Jukebox.svelte';
	import RiderTile from '$lib/room/RiderTile.svelte';
	import RoomRail from '$lib/room/RoomRail.svelte';
	import SidePanel from '$lib/room/SidePanel.svelte';
	import SprintMoment from '$lib/room/SprintMoment.svelte';
	import TargetWidget from '$lib/room/TargetWidget.svelte';
	import TvMode from '$lib/room/TvMode.svelte';

	let {
		slug,
		role,
		roomName,
	}: { slug: string; role: string; roomName: string } = $props();

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
	const shared = $derived(live.tick?.state);
	const running = $derived(shared?.phase === 'running');
	const phase = $derived(
		shared?.phase === 'countdown'
			? ('countdown' as const)
			: shared?.phase === 'running' || shared?.phase === 'paused'
				? ('live' as const)
				: ('lounge' as const),
	);
	const parsed = $derived(parseSharedWorkout(shared?.workoutJson));
	const segments = $derived(parsed.segments);

	// ── The rail: your rooms, your mic ────────────────────────────────────────
	let railRooms = $state<RailRoom[]>([]);
	$effect(() => {
		void api<{ rooms: { slug: string; name: string }[] }>('/api/rooms').then(
			(res) => {
				if (res.ok)
					railRooms = res.data.rooms.map((room) => ({
						name: room.name,
						slug: room.slug,
						live: room.slug === slug && phase === 'live',
						members: 0,
					}));
			},
		);
	});

	// ── Riders: the one grid, fed by ticks ────────────────────────────────────
	// Last-known metrics survive a missed tick so a blip shows a stale tile,
	// never a zeroed one (the mock's `stale` state, real).
	const lastKnown = new Map<
		string,
		{ watts: number; cadence: number; hr: number; at: number }
	>();
	let myTrace = $state<{ t: number; w: number }[]>([]);

	const riders = $derived.by((): RoomRider[] => {
		const tick = live.tick;
		if (!tick) return [];
		const now = tick.at;
		return tick.roster.map((rider) => {
			const metrics = tick.riders?.[rider.id];
			if (metrics)
				lastKnown.set(rider.id, {
					watts: metrics.watts,
					cadence: metrics.cadence ?? 0,
					hr: metrics.hr ?? 0,
					at: now,
				});
			const known = lastKnown.get(rider.id);
			const stale = !metrics && !!known && now - known.at < 30_000;
			const you = rider.id === account.me?.id;
			const target =
				running && segments.length > 0 && rider.ftpWatts > 0
					? (targetAt(segments, rider.ftpWatts, shared?.elapsed ?? 0)
							.targetWatts ?? 0)
					: 0;
			return {
				id: rider.id,
				name: rider.name,
				ftp: rider.ftpWatts,
				kg: rider.weightKg,
				you,
				coach: rider.role !== 'member',
				cameraOn: !!av.videoOf[rider.id],
				muted: false,
				speaking: !!av.speaking[rider.id],
				hue: [...rider.id].reduce(
					(h, c) => (h * 31 + c.charCodeAt(0)) % 360,
					7,
				),
				watts: metrics?.watts ?? (stale ? (known?.watts ?? 0) : 0),
				cadence: metrics?.cadence ?? (stale ? (known?.cadence ?? 0) : 0),
				hr: metrics?.hr ?? (stale ? (known?.hr ?? 0) : 0),
				stale,
				paused: false,
				lateJoined: false,
				target,
				execution: tick.execution?.[rider.id] ?? 1,
				trace: you ? myTrace : [],
				eliminated: tick.game?.riders?.[rider.id]?.eliminated,
			};
		});
	});
	const you = $derived(
		riders.find((r) => r.you) ?? {
			id: '',
			name: account.me?.displayName ?? 'you',
			ftp: profile.current.ftp,
			kg: profile.current.kg,
			you: true,
			coach: canControl,
			cameraOn: false,
			muted: false,
			speaking: false,
			hue: 210,
			watts: 0,
			cadence: 0,
			hr: 0,
			stale: false,
			paused: false,
			lateJoined: false,
			target: 0,
			execution: 1,
			trace: myTrace,
		},
	);
	const block = $derived(
		running && segments.length > 0
			? describeBlock(
					targetAt(segments, you.ftp, shared?.elapsed ?? 0),
					segments,
					parsed.workout,
					you.ftp,
				)
			: null,
	);

	// ── Layouts and tile metrics (#22) — per-rider conveniences ──────────────
	type Layout = 'metrics' | 'video' | 'media';
	const layouts: { id: Layout; label: string }[] = [
		{ id: 'metrics', label: 'Metrics' },
		{ id: 'video', label: 'Video' },
		{ id: 'media', label: 'Media' },
	];
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
	let tileMetrics = $state<TileMetric[]>(['hr']);
	function toggleMetric(id: TileMetric) {
		tileMetrics = tileMetrics.includes(id)
			? tileMetrics.filter((m) => m !== id)
			: [...tileMetrics, id];
	}
	const riderGrid = $derived(
		layout === 'media'
			? 'shrink-0 grid-cols-3 sm:grid-cols-6'
			: layout === 'video'
				? 'sm:grid-cols-2 xl:grid-cols-3'
				: 'shrink-0 sm:grid-cols-2 xl:grid-cols-3',
	);

	// ── Sounds follow state (riders are not watching) ─────────────────────────
	$effect(() => {
		setDucked(
			Object.entries(av.speaking).some(
				([id, active]) => active && id !== account.me?.id,
			),
		);
	});
	let heardCount = -1;
	$effect(() => {
		if (shared?.phase !== 'countdown') {
			if (shared?.phase === 'running' && heardCount > 0) {
				heardCount = -1;
				play('go');
			}
			return;
		}
		const left = shared.countdownRemaining ?? 0;
		if (left <= 3 && left > 0 && left !== heardCount) {
			heardCount = left;
			play('countdown');
		}
	});

	// ── Coach controls ────────────────────────────────────────────────────────
	let pickedId = $state(library[0].id);
	const GAMES = [
		{ id: 'backyard-ramp', label: 'Backyard Ramp' },
		{ id: 'collective-ramp', label: 'Collective Ramp' },
		{ id: 'floor-is-lava', label: 'Floor is Lava' },
		{ id: 'watt-golf', label: 'Watt Golf' },
		{ id: 'sprint-roulette', label: 'Sprint Roulette' },
		{ id: 'points-race', label: 'Points Race' },
		{ id: 'team-relay', label: 'Team Relay' },
	];
	let pickedGame = $state(GAMES[0].id);

	function pickAndStart() {
		const entry = library.find((w) => w.id === pickedId);
		if (!entry) return;
		const flat = flatten(entry.workout);
		const total = flat.reduce(
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

	// ── Riding along ─────────────────────────────────────────────────────────
	let trainer = $state<Trainer | null>(null);
	let rideError = $state<string | null>(null);
	let hrSource = $state<'heart-rate' | 'trainer' | null>(null);
	let seq = 0;
	let unsubscribe: (() => void) | undefined;

	const myTarget = $derived.by(() => {
		const game = live.tick?.game;
		const mine = game?.riders?.[account.me?.id ?? ''];
		if (game?.phase === 'running' && mine && mine.targetPct) {
			return Math.round(mine.targetPct * profile.current.ftp);
		}
		if (!shared || shared.phase !== 'running' || segments.length === 0)
			return 0;
		return (
			targetAt(segments, profile.current.ftp, shared.elapsed).targetWatts ?? 0
		);
	});

	const sprintLive = $derived.by(() => {
		const sprint = live.tick?.sprint;
		if (!sprint) return false;
		const at = live.tick?.at ?? Date.now();
		return at >= sprint.startsAtMs && at < sprint.endsAtMs;
	});
	let sprintMode = false;
	$effect(() => {
		if (!trainer) return;
		if (sprintLive) {
			if (!sprintMode) {
				sprintMode = true;
				if (profile.current.singleSpeed) {
					void trainer.setTargetPower(profile.current.ftp * 2);
				} else {
					const grade = profile.current.sprintGrade;
					void trainer.setSimulation(0);
					setTimeout(() => {
						if (sprintMode) void trainer?.setSimulation(grade);
					}, 500);
				}
			}
			return;
		}
		sprintMode = false;
		void trainer.setTargetPower(myTarget);
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
				live.sendMetrics(wireMetrics(metrics, profile.current.shareHr, ++seq));
				if (running)
					myTrace = [
						...myTrace.slice(-898),
						{ t: shared?.elapsed ?? 0, w: metrics.watts },
					];
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

	// ── Connection fault + jukebox helpers ────────────────────────────────────
	let droppedAt = $state<number | null>(null);
	$effect(() => {
		if (live.status === 'reconnecting' && droppedAt === null)
			droppedAt = Date.now();
		if (live.status === 'live') droppedAt = null;
	});
	const queueView = $derived(
		(live.tick?.jukebox?.queue ?? []).map((entry) => ({
			title: entry.title,
			by: entry.addedBy,
		})),
	);
	const currentTitle = $derived(live.tick?.jukebox?.current?.title ?? '');

	const readouts = $derived([
		{ label: 'rpm', value: String(you.cadence) },
		...(you.hr > 0 ? [{ label: 'bpm', value: String(you.hr) }] : []),
		{
			label: 'w/kg',
			value: you.kg > 0 ? (you.watts / you.kg).toFixed(1) : '–',
		},
		{ label: 'exec', value: `${Math.round(you.execution * 100)}%` },
	]);
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (tv = false)} />

{#if tv}
	<div class="bg-surface fixed inset-0 z-50">
		<button
			onclick={() => (tv = false)}
			class="border-muted/30 text-muted absolute bottom-4 left-4 z-10 rounded border px-3 py-1.5 text-xs hover:text-white"
			>Exit TV mode (esc)</button
		>
		<TvMode
			{riders}
			{segments}
			total={shared?.totalSeconds ?? 0}
			elapsed={shared?.elapsed ?? 0}
			{block}
			{roomName}
			workoutName={shared?.workoutName ?? ''}
		/>
	</div>
{/if}

<div class="border-muted/15 mt-6 flex overflow-hidden rounded-lg border">
	<div class="hidden lg:block">
		<RoomRail
			{you}
			live={phase === 'live'}
			rooms={railRooms}
			activeSlug={slug}
			micOn={av.micOn}
			camOn={av.camOn}
			onMic={() => (av.status === 'live' ? av.toggleMic() : av.join())}
			onCam={() => (av.status === 'live' ? av.toggleCam() : av.join())}
		/>
	</div>

	<main class="relative flex min-w-0 flex-1 flex-col overflow-hidden px-5 py-4">
		<CheerLayer cheers={live.tick?.cheers} />

		<header class="flex flex-wrap items-center gap-x-4 gap-y-2 pb-4">
			<div>
				<h1 class="font-display text-lg leading-tight font-bold">{roomName}</h1>
				<p class="text-muted text-xs">
					{riders.length} rider{riders.length === 1 ? '' : 's'} ·
					{#if phase === 'lounge'}
						{shared?.workoutName ? `${shared.workoutName} loaded` : 'lounge'}
					{:else}
						{shared?.workoutName}
					{/if}
				</p>
			</div>

			<div class="border-muted/20 ml-auto flex gap-1 rounded border p-0.5">
				{#each layouts as option (option.id)}
					<button
						onclick={() => setLayout(option.id)}
						class="rounded px-2.5 py-1 text-xs {layout === option.id
							? 'bg-surface-raised text-white'
							: 'text-muted hover:text-white'}">{option.label}</button
					>
				{/each}
			</div>
			<div class="border-muted/20 flex gap-1 rounded border p-0.5">
				{#each TILE_METRICS as metric (metric.id)}
					<button
						onclick={() => toggleMetric(metric.id)}
						class="rounded px-2 py-1 text-xs {tileMetrics.includes(metric.id)
							? 'bg-surface-raised text-white'
							: 'text-muted hover:text-white'}">{metric.label}</button
					>
				{/each}
			</div>
			<button
				onclick={() => (tv = true)}
				class="border-muted/20 text-muted rounded border px-2.5 py-1 text-xs hover:text-white"
				>TV mode</button
			>

			{#if canControl && shared}
				{#if shared.phase === 'idle' || shared.phase === 'done'}
					<div class="flex gap-1.5">
						<select
							bind:value={pickedId}
							class="border-muted/25 bg-surface rounded border px-2 py-1 text-xs"
						>
							{#each library as entry (entry.id)}
								<option value={entry.id}>{entry.workout.name}</option>
							{/each}
						</select>
						<button
							onclick={pickAndStart}
							class="rounded bg-white px-3 py-1 text-xs font-semibold text-black hover:bg-white/90"
							>Start</button
						>
						{#if !live.tick?.game}
							<select
								bind:value={pickedGame}
								class="border-muted/25 bg-surface rounded border px-2 py-1 text-xs"
							>
								{#each GAMES as g (g.id)}<option value={g.id}>{g.label}</option
									>{/each}
							</select>
							<button
								onclick={() => live.control('game', undefined, pickedGame)}
								class="border-neon/50 hover:bg-neon/10 rounded border px-2.5 py-1 text-xs"
								>Game</button
							>
						{/if}
					</div>
				{:else}
					<div class="border-muted/20 flex gap-1 rounded border p-0.5">
						{#if shared.phase === 'running'}
							<button
								onclick={() => live.control('sprint')}
								class="text-watt rounded px-2.5 py-1 text-xs">⚡ Sprint</button
							>
							<button
								onclick={() => live.control('pause')}
								class="text-muted rounded px-2.5 py-1 text-xs hover:text-white"
								>Pause</button
							>
						{:else if shared.phase === 'paused'}
							<button
								onclick={() => live.control('resume')}
								class="rounded px-2.5 py-1 text-xs">Resume</button
							>
						{/if}
						<button
							onclick={() => live.control('end')}
							class="text-z6 rounded px-2.5 py-1 text-xs">End</button
						>
					</div>
				{/if}
			{/if}

			{#if phase === 'live' && shared}
				<div class="text-right">
					<div
						class="font-display text-2xl leading-none font-bold tabular-nums"
					>
						{formatClock(shared.elapsed)}
					</div>
					<div class="text-muted text-[10px] tracking-wider uppercase">
						elapsed
					</div>
				</div>
			{/if}
		</header>

		{#if live.status !== 'live'}
			<div class="mb-3">
				<FaultBanner
					fault={{
						kind: 'room',
						state:
							live.status === 'connecting' ? 'reconnecting' : 'reconnecting',
					}}
					bufferedSeconds={droppedAt
						? Math.round((Date.now() - droppedAt) / 1000)
						: 0}
					onRecover={() => location.reload()}
				/>
			</div>
		{/if}

		{#if shared?.phase === 'paused'}
			<div
				class="border-z5/40 bg-z5/10 mb-3 flex items-center gap-3 rounded-lg border px-4 py-2.5"
			>
				<span class="bg-z5 h-2 w-2 shrink-0 animate-pulse rounded-full"></span>
				<p class="text-xs">
					<span class="font-medium">The session is paused.</span>
					<span class="text-muted"
						>Targets are released — spin easy until the coach resumes.</span
					>
				</p>
			</div>
		{/if}

		{#if layout === 'media'}
			<div class="flex min-h-0 justify-center">
				<Jukebox
					jukebox={live.tick?.jukebox}
					send={(action, videoId, title) =>
						live.jukebox(action, videoId, title)}
					large
					ducked={Object.entries(av.speaking).some(
						([id, active]) => active && id !== account.me?.id,
					)}
				/>
			</div>
		{/if}

		<div class="grid gap-3 {riderGrid} {layout === 'media' ? 'mt-3' : ''}">
			{#each riders as rider (rider.id)}
				<RiderTile
					{rider}
					{phase}
					stretch={layout === 'video'}
					metrics={tileMetrics}
					videoKey={av.videoOf[rider.id]}
					videoAttach={av.videoOf[rider.id]
						? (node) => av.attach(rider.id, node)
						: undefined}
				/>
			{/each}
		</div>

		{#if !trainer}
			<div class="mt-3 flex flex-wrap items-center gap-2">
				<button
					onclick={() => ride(new FtmsTrainer())}
					disabled={typeof navigator === 'undefined' || !navigator.bluetooth}
					class="rounded bg-white px-4 py-2 text-sm font-medium text-black hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-40"
					>Pair trainer and ride</button
				>
				<button
					onclick={() =>
						ride(
							new SimulatedTrainer({ baseWatts: profile.current.ftp * 0.75 }),
						)}
					class="border-muted/30 hover:border-muted/60 rounded border px-4 py-2 text-sm"
					>Ride simulated</button
				>
				{#if rideError}<span class="text-z6 text-xs">{rideError}</span>{/if}
			</div>
		{/if}

		{#if live.tick?.game}
			<div class="mt-3">
				<GamePanel
					game={live.tick.game}
					roster={live.tick?.roster ?? []}
					end={() => live.control('game-end')}
					{canControl}
				/>
			</div>
		{/if}

		{#if phase === 'countdown' && shared}
			<div
				class="border-neon/40 bg-surface-raised mt-3 flex items-center justify-center gap-4 rounded-lg border py-6"
			>
				<span
					class="text-watt glow-text-strong font-display text-5xl leading-none font-bold tabular-nums"
					>{shared.countdownRemaining}</span
				>
				<div>
					<p class="font-display font-bold">{shared.workoutName}</p>
					<p class="text-muted text-xs">
						The session is starting — get pedalling
					</p>
				</div>
			</div>
		{:else if phase === 'live'}
			<div class="mt-3 flex items-center justify-end gap-5">
				{#each readouts as readout (readout.label)}
					<div class="text-right">
						<span
							class="font-display text-lg leading-none font-semibold tabular-nums"
							>{readout.value}</span
						>
						<span class="text-muted ml-1 text-[10px] tracking-wider uppercase"
							>{readout.label}</span
						>
					</div>
				{/each}
			</div>
			{#if trainer && hrSource}
				<p class="text-muted mt-1 text-right text-[10px]">
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

			{#if live.tick?.sprint}
				<div class="mt-2">
					<SprintMoment sprint={live.tick.sprint} myWatts={you.watts} />
				</div>
			{:else if block}
				<div class="mt-2">
					<IntervalStrip {block} bias={1} />
				</div>
				<div class="mt-2">
					<TargetWidget {you} variant="notch" compact={layout !== 'metrics'} />
				</div>
			{/if}
			<div class="mt-2 grid gap-2 lg:grid-cols-[1fr_260px]">
				<div class="overflow-hidden rounded-lg">
					<IntervalGraph
						{segments}
						total={shared?.totalSeconds ?? 0}
						elapsed={shared?.elapsed ?? 0}
						ftp={you.ftp}
						trace={you.trace}
						compact={layout !== 'metrics'}
					/>
				</div>
				<ExecutionMeter {riders} />
			</div>
		{/if}
	</main>

	<div class="hidden xl:block">
		<SidePanel
			live={phase === 'live'}
			showPlayer={layout !== 'media'}
			queue={queueView}
			onAdd={(url) => void addYouTubeUrl(url, live.jukebox)}
			onCheer={(emoji) => live.cheer(emoji)}
		>
			{#snippet player()}
				<Jukebox
					jukebox={live.tick?.jukebox}
					send={(action, videoId, title) =>
						live.jukebox(action, videoId, title)}
					ducked={Object.entries(av.speaking).some(
						([id, active]) => active && id !== account.me?.id,
					)}
				/>
			{/snippet}
		</SidePanel>
	</div>
</div>
{#if currentTitle && layout === 'media'}<span class="hidden"
		>{currentTitle}</span
	>{/if}
