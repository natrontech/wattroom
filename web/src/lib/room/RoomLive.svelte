<script lang="ts">
	import { dev } from '$app/environment';
	import {
		LogOut as LeaveIcon,
		Mic,
		MicOff,
		ScreenShare,
		ScreenShareOff,
		Settings,
		Tv,
		Video as VideoIcon,
		VideoOff,
	} from '@lucide/svelte';
	import { onDestroy } from 'svelte';
	import { play, setDucked, setMuted } from '$lib/sound/cues';
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
	import { durationSeconds, flatten, targetAt } from '$lib/workout/engine';
	import { library } from '$lib/workout/library';
	import { roomConnection } from '$lib/room/connection.svelte';
	import { parseSharedSegments, parseSharedWorkout } from '$lib/room/workout';
	import { addYouTubeUrl } from '$lib/room/jukebox-add';
	import { wireMetrics } from '$lib/room/wire';
	import {
		describeBlock,
		TILE_METRICS,
		type RoomRider,
		type TileMetric,
	} from '$lib/room/view';
	import CheerLayer from '$lib/room/CheerLayer.svelte';
	import ExecutionMeter from '$lib/room/ExecutionMeter.svelte';
	import FaultBanner from '$lib/room/FaultBanner.svelte';
	import GamePanel from '$lib/room/GamePanel.svelte';
	import IntervalStrip from '$lib/room/IntervalStrip.svelte';
	import Jukebox from '$lib/room/Jukebox.svelte';
	import RiderTile from '$lib/room/RiderTile.svelte';
	import { createCustomStore } from '$lib/workout/custom.svelte';
	import Select from '$lib/components/Select.svelte';
	import WhenPicker from '$lib/components/WhenPicker.svelte';
	import SidePanel from '$lib/room/SidePanel.svelte';
	import SprintMoment from '$lib/room/SprintMoment.svelte';
	import TargetWidget from '$lib/room/TargetWidget.svelte';
	import TvMode from '$lib/room/TvMode.svelte';
	import RoomAdmin from '$lib/room/RoomAdmin.svelte';
	import SessionSummary from '$lib/ride/SessionSummary.svelte';
	import type { Medal } from '$lib/components/MedalCard.svelte';
	import { ZONE_TEXT, zoneOf } from '$lib/components/zones';

	interface AdminMember {
		id: string;
		displayName: string;
		role: string;
	}
	interface AdminMedal {
		kind: string;
		rider: string;
		awardedAt: string;
	}
	let {
		slug,
		role,
		roomName,
		code = '',
		soundPack = 'base',
		members = [],
		medals = [],
		streakWeeks = 0,
		monthKj = 0,
		adminBusy = false,
		onRole,
		onRemove,
		upcoming = [],
		onSchedule,
		onUnschedule,
	}: {
		slug: string;
		role: string;
		roomName: string;
		code?: string;
		soundPack?: string;
		members?: AdminMember[];
		medals?: AdminMedal[];
		streakWeeks?: number;
		monthKj?: number;
		adminBusy?: boolean;
		onRole: (userId: string, role: string) => void;
		onRemove: (userId: string) => void;
		upcoming?: {
			id: string;
			workoutName: string;
			workoutJson: string;
			startsAt: string;
			createdBy: string;
		}[];
		onSchedule: (name: string, json: string, startsAt: string) => void;
		onUnschedule: (id: string) => void;
	} = $props();

	// #173: the connection outlives this page — you stay in the room while
	// you browse. Leaving is the rail's explicit button, never unmount.
	// svelte-ignore state_referenced_locally
	const connection = roomConnection.join(slug);
	const live = connection.live;
	const av = connection.av;
	const profile = createProfileStore();
	onDestroy(() => {
		stopRiding();
	});

	// SPEC room audio: the gate threshold doubles while the jukebox plays.
	$effect(() => {
		av.setMusicPlaying(!!live.tick?.jukebox?.playing);
	});

	// Space is push-to-talk while that mode is on — never while typing.
	function pttKey(event: KeyboardEvent, held: boolean) {
		if (av.mode !== 'ptt' || event.code !== 'Space') return;
		const target = event.target as HTMLElement;
		if (
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			target.isContentEditable
		)
			return;
		event.preventDefault();
		av.setPtt(held);
	}

	// The room's pack governs the cue mixer while you are here ('silent' =
	// visual cues only); leaving restores sound for the rest of the app.
	$effect(() => {
		if (soundPack === 'silent') {
			setMuted(true);
			return () => setMuted(false);
		}
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
			const target = you
				? myTarget
				: running && segments.length > 0 && rider.ftpWatts > 0
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
				inVoice: rider.id in av.voice,
				muted: av.voice[rider.id] === 'muted',
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
		// 'media' is deliberately not restored: landing in a player layout
		// with an empty deck is a void (#170) — it is a mode you enter when
		// music plays, not a preference.
		if (stored === 'video') layout = stored;
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

	function startWorkout(picked: import('$lib/workout/types').Workout) {
		mySamples = [];
		myTrace = [];
		const flat = flatten(picked);
		const total = flat.reduce(
			(t, s) => Math.max(t, s.startSeconds + s.seconds),
			0,
		);
		live.control('pick', {
			name: picked.name,
			json: JSON.stringify(picked),
			totalSeconds: total,
		});
		live.control('start');
		setup = false;
	}

	// ── Session setup (#115): training-first, games one step away ─────────────
	let setup = $state(false);
	let setupGames = $state(false);
	const custom = createCustomStore();
	// Recently ridden first: the rider's history ranks the shelf.
	let recency = $state<Map<string, number>>(new Map());
	$effect(() => {
		if (!setup || recency.size) return;
		void api<{ rides: { workoutName: string }[] }>('/api/rides').then((res) => {
			if (!res.ok) return;
			const ranked = new Map<string, number>();
			res.data.rides.forEach((ride, i) => {
				if (!ranked.has(ride.workoutName)) ranked.set(ride.workoutName, i);
			});
			recency = ranked;
		});
	});
	const shelf = $derived(
		[
			...custom.all.map((entry) => ({ ...entry, yours: true })),
			...library.map((entry) => ({ ...entry, yours: false })),
		].sort(
			(a, b) =>
				(recency.get(a.workout.name) ?? 999) -
				(recency.get(b.workout.name) ?? 999),
		),
	);
	const setupPicked = $derived(
		shelf.find((entry) => entry.id === pickedId) ?? shelf[0],
	);
	const setupSegments = $derived(
		setupPicked ? flatten(setupPicked.workout) : [],
	);

	// ── Planned rides (#116) ──────────────────────────────────────────────────
	let planAt = $state(defaultPlanAt());
	function defaultPlanAt(): string {
		const t = new Date(Date.now() + 60 * 60 * 1000);
		t.setMinutes(0, 0, 0);
		t.setMinutes(t.getMinutes() - t.getTimezoneOffset());
		return t.toISOString().slice(0, 16); // datetime-local format
	}
	function formatWhen(iso: string): string {
		return new Date(iso).toLocaleString(undefined, {
			weekday: 'short',
			day: '2-digit',
			month: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
		});
	}
	/** Startable a little early and through the grace the server keeps it visible. */
	function due(iso: string): boolean {
		const diff = new Date(iso).getTime() - Date.now();
		return diff < 10 * 60 * 1000 && diff > -30 * 60 * 1000;
	}
	function startScheduled(entry: (typeof upcoming)[number]) {
		const segments = parseSharedSegments(entry.workoutJson);
		const total = segments.reduce(
			(t, s) => Math.max(t, s.startSeconds + s.seconds),
			0,
		);
		if (total === 0) return;
		mySamples = [];
		myTrace = [];
		live.control('pick', {
			name: entry.workoutName,
			json: entry.workoutJson,
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

	// Bias is personal: ±% on my own targets, the shared timeline untouched.
	let bias = $state(1);
	function nudgeBias(step: number) {
		bias = Math.min(1.2, Math.max(0.8, Math.round((bias + step) * 100) / 100));
	}

	const myTarget = $derived.by(() => {
		const game = live.tick?.game;
		const mine = game?.riders?.[account.me?.id ?? ''];
		if (game?.phase === 'running' && mine && mine.targetPct) {
			return Math.round(mine.targetPct * profile.current.ftp);
		}
		if (!shared || shared.phase !== 'running' || segments.length === 0)
			return 0;
		const raw =
			targetAt(segments, profile.current.ftp, shared.elapsed).targetWatts ?? 0;
		return Math.round(raw * bias);
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
				if (running) {
					myTrace = [
						...myTrace.slice(-898),
						{ t: shared?.elapsed ?? 0, w: metrics.watts },
					];
					mySamples.push({ watts: Math.max(0, Math.round(metrics.watts)) });
				}
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
	const myZone = $derived(zoneOf(you.watts, you.ftp));
	let admin = $state(false);

	// Session close (#39's summary design): my own samples this session become
	// the summary, and my medal — if the room awarded one — comes back with the
	// refreshed room payload a moment after the pipeline commits.
	let mySamples = $state<{ watts: number }[]>([]);
	let summaryDismissed = $state(false);
	let myMedal = $state<Medal | undefined>(undefined);
	let medalFetched = false;
	const MEDAL_META: Record<string, { name: string; criterion: string }> = {
		diesel: { name: 'Diesel', criterion: 'lowest power variability' },
		metronome: { name: 'Metronome', criterion: 'best execution score' },
		hammer: { name: 'Hammer', criterion: 'best 5 s w/kg' },
		lanterne_rouge: {
			name: 'Lanterne Rouge',
			criterion: 'last on the podium metric, but finished',
		},
	};
	$effect(() => {
		if (shared?.phase === 'running') {
			summaryDismissed = false;
			medalFetched = false;
			myMedal = undefined;
		}
		if (shared?.phase !== 'done' || medalFetched || mySamples.length < 60)
			return;
		medalFetched = true;
		// The pipeline commits within a tick or two of the close.
		setTimeout(() => {
			void api<{
				medals?: { kind: string; rider: string; awardedAt: string }[];
			}>(`/api/rooms/${slug}`).then((res) => {
				if (!res.ok) return;
				const today = new Date().toISOString().slice(0, 10);
				const mine = (res.data.medals ?? []).find(
					(medal) =>
						medal.rider === account.me?.displayName &&
						medal.awardedAt === today,
				);
				if (mine) {
					const meta = MEDAL_META[mine.kind];
					const kjTotal = Math.round(
						mySamples.reduce((sum, sample) => sum + sample.watts, 0) / 1000,
					);
					myMedal = {
						name: meta?.name ?? mine.kind,
						criterion: meta?.criterion ?? '',
						rider: account.me?.displayName ?? 'You',
						value: String(Math.round(you.execution * 100)),
						unit: '%',
						kj: kjTotal,
						xp: 0,
					};
				}
			});
		}, 2500);
	});
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape') tv = false;
		if (!e.repeat) pttKey(e, true);
	}}
	onkeyup={(e) => pttKey(e, false)}
/>

{#if tv}
	<div class="bg-surface fixed inset-0 z-50">
		<button
			onclick={() => (tv = false)}
			class="border-muted/30 text-muted hover:text-ink absolute bottom-4 left-4 z-10 rounded border px-3 py-1.5 text-xs"
			>Exit TV mode (esc)</button
		>
		<TvMode
			{riders}
			{segments}
			total={shared?.totalSeconds ?? 0}
			elapsed={shared?.elapsed ?? 0}
			{block}
			{roomName}
			{code}
			live={phase === 'live'}
			workoutName={shared?.workoutName ?? ''}
		/>
	</div>
{/if}

{#if setup}
	<!-- Session setup (#115): the room's "what are we doing tonight" moment.
	     Training is the whole default flow; games are one step away. -->
	<button
		class="bg-paper/50 fixed inset-0 z-40"
		aria-label="Close session setup"
		onclick={() => (setup = false)}
	></button>
	<div
		class="border-muted/15 bg-surface fixed inset-x-4 top-[8dvh] bottom-[8dvh] z-50 flex flex-col overflow-hidden rounded-xl border md:right-auto md:left-1/2 md:w-[44rem] md:-translate-x-1/2"
	>
		<header class="border-ink/5 flex items-center gap-3 border-b px-5 py-4">
			<h2 class="font-display text-lg font-bold">Tonight's session</h2>
			<button
				onclick={() => (setup = false)}
				class="text-muted hover:text-ink ml-auto text-sm">Close</button
			>
		</header>

		<div class="flex min-h-0 flex-1">
			<ul class="border-ink/5 w-56 shrink-0 overflow-y-auto border-r p-2">
				{#each shelf as entry (entry.id)}
					<li>
						<button
							onclick={() => (pickedId = entry.id)}
							class="w-full rounded px-3 py-2.5 text-left {setupPicked?.id ===
							entry.id
								? 'bg-surface-raised text-ink'
								: 'text-muted hover:text-ink'}"
						>
							<span class="block truncate text-sm font-medium"
								>{entry.workout.name}</span
							>
							<span class="block font-mono text-[11px] tabular-nums"
								>{formatClock(durationSeconds(entry.workout))}{entry.yours
									? ' · yours'
									: ''}</span
							>
						</button>
					</li>
				{/each}
			</ul>

			<div class="flex min-w-0 flex-1 flex-col p-4">
				{#if setupPicked}
					<p class="font-display font-bold">{setupPicked.workout.name}</p>
					<p class="text-muted mt-1 text-xs">
						{'summary' in setupPicked ? setupPicked.summary : ''}
					</p>
					<div
						class="border-muted/15 bg-surface-raised mt-3 overflow-hidden rounded-lg border"
					>
						<IntervalGraph
							segments={setupSegments}
							total={durationSeconds(setupPicked.workout)}
							elapsed={0}
							ftp={profile.current.ftp}
							trace={[]}
						/>
					</div>
					<div class="mt-4 flex flex-wrap items-center gap-2">
						<button
							onclick={() => startWorkout(setupPicked.workout)}
							class="bg-ink text-paper hover:bg-ink/90 rounded px-6 py-3 text-sm font-semibold"
							>Start {setupPicked.workout.name}</button
						>
						<span class="text-muted text-xs">or plan it:</span>
						<WhenPicker bind:value={planAt} />
						<button
							onclick={() => {
								onSchedule(
									setupPicked.workout.name,
									JSON.stringify(setupPicked.workout),
									new Date(planAt).toISOString(),
								);
								setup = false;
							}}
							disabled={adminBusy || !planAt}
							class="border-muted/25 hover:border-muted/60 rounded border px-3 py-2 text-xs disabled:opacity-40"
							>Plan</button
						>
					</div>
				{/if}

				<div class="border-ink/5 mt-auto border-t pt-3">
					{#if !setupGames}
						<button
							onclick={() => (setupGames = true)}
							class="text-muted hover:text-ink text-sm underline"
							>Play a game instead</button
						>
					{:else if !live.tick?.game}
						<div class="flex flex-wrap items-center gap-2">
							<Select
								bind:value={pickedGame}
								label="Game mode"
								options={GAMES.map((g) => ({ value: g.id, label: g.label }))}
							/>
							<button
								onclick={() => {
									live.control('game', undefined, pickedGame);
									setup = false;
								}}
								class="border-neon/50 hover:bg-neon/10 rounded border px-4 py-2 text-sm"
								>Start game</button
							>
						</div>
					{/if}
				</div>
			</div>
		</div>
	</div>
{/if}

<RoomAdmin
	bind:open={admin}
	{slug}
	{code}
	{members}
	{medals}
	isOwner={role === 'owner'}
	myId={account.me?.id}
	{streakWeeks}
	{monthKj}
	busy={adminBusy}
	{onRole}
	{onRemove}
/>

<!-- The rail is the layout's (#191 — one instance across navigation);
     this page is main | panel inside that frame. -->
<div class="bg-surface text-ink flex h-full overflow-hidden">
	<main
		class="relative flex min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-5 py-4"
	>
		<CheerLayer cheers={live.tick?.cheers} />

		<header class="flex flex-wrap items-center gap-x-5 gap-y-2 pb-4">
			<div>
				<h1 class="font-display text-lg leading-tight font-bold">{roomName}</h1>
				<p class="text-muted text-xs">
					{riders.length} rider{riders.length === 1 ? '' : 's'} ·
					{#if phase === 'lounge'}
						{shared?.workoutName
							? `${shared.workoutName} loaded`
							: 'in the lounge'}
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
							? 'bg-surface-raised text-ink'
							: 'text-muted hover:text-ink'}">{option.label}</button
					>
				{/each}
			</div>
			<div class="border-muted/20 flex gap-1 rounded border p-0.5">
				{#each TILE_METRICS as metric (metric.id)}
					<button
						onclick={() => toggleMetric(metric.id)}
						class="rounded px-2 py-1 text-xs {tileMetrics.includes(metric.id)
							? 'bg-surface-raised text-ink'
							: 'text-muted hover:text-ink'}">{metric.label}</button
					>
				{/each}
			</div>
			<button
				onclick={() => (tv = true)}
				class="border-muted/20 text-muted hover:text-ink inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs"
				><Tv size={13} /> TV</button
			>
			<button
				onclick={() => (admin = true)}
				class="border-muted/20 text-muted hover:text-ink inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs"
				aria-label="room settings"><Settings size={13} /> Room</button
			>

			{#if canControl && shared}
				{#if shared.phase === 'idle' || shared.phase === 'done'}
					<!-- Training-first (#115): one affordance; games live inside. -->
					<button
						onclick={() => (setup = true)}
						class="bg-ink text-paper hover:bg-ink/90 rounded px-4 py-2 text-sm font-semibold"
						>Pick a workout</button
					>
				{:else}
					<div class="border-muted/20 flex gap-1 rounded border p-0.5">
						{#if shared.phase === 'running'}
							<button
								onclick={() => live.control('sprint')}
								class="text-watt rounded px-2.5 py-1 text-xs">⚡ Sprint</button
							>
							<button
								onclick={() => live.control('pause')}
								class="text-muted hover:text-ink rounded px-2.5 py-1 text-xs"
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
		</header>

		{#if phase === 'live' && shared}
			<div class="pb-3">
				<div class="font-display text-4xl leading-none font-bold tabular-nums">
					{formatClock(shared.elapsed)}
				</div>
				<div class="text-muted mt-1 text-[10px] tracking-wider uppercase">
					elapsed
				</div>
			</div>
		{/if}

		{#if live.status !== 'live'}
			<div class="mb-3">
				<FaultBanner
					fault={{ kind: 'room', state: 'reconnecting' }}
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
			<!-- Media-focus: the player takes the main area, riders drop to a strip. -->
			<div
				class="flex min-h-0 flex-col items-center justify-center gap-3 {live
					.tick?.jukebox?.current
					? 'flex-1'
					: ''}"
			>
				{#if !live.tick?.jukebox?.current && !live.tick?.jukebox?.queue?.length}
					<p
						class="text-muted border-muted/10 max-w-md rounded-lg border border-dashed px-5 py-3 text-center text-xs"
					>
						Nothing queued yet — paste a YouTube link and the whole room hears
						it in sync, ducked under voice.
					</p>
				{/if}
				<Jukebox
					jukebox={live.tick?.jukebox}
					send={(action, videoId, title, jamUrl, positionSec) =>
						live.jukebox(action, videoId, title, jamUrl, positionSec)}
					large
					ducked={Object.entries(av.speaking).some(
						([id, active]) => active && id !== account.me?.id,
					)}
				/>
			</div>
		{/if}

		{#if layout === 'video' && !Object.values(av.videoOf).some(Boolean)}
			<p
				class="text-muted border-muted/10 mb-3 rounded-lg border border-dashed px-5 py-4 text-center text-xs"
			>
				Nobody's on camera — join voice and yours turns on. Tiles show video the
				moment it arrives.
			</p>
		{/if}

		{#if av.screenOf}
			{@const sharer =
				riders.find((r) => r.id === av.screenOf?.id)?.name ?? 'someone'}
			<!-- The projector (#206): one shared screen, room-wide, above the
			     people — a screen is a document, so contain, never crop. -->
			<div class="mb-3">
				<div
					class="ring-neon/40 overflow-hidden rounded-lg bg-black ring-1"
					style="width: min(100%, 880px); aspect-ratio: 16/9"
				>
					{#key av.screenOf.key}
						<div
							class="h-full w-full"
							{@attach (node) => av.attachScreen(node)}
						></div>
					{/key}
				</div>
				<p class="text-muted mt-1 text-[11px]">
					{sharer} is sharing their screen
					{#if av.sharing}
						· <button
							onclick={() => void av.toggleShare()}
							class="hover:text-ink underline">stop</button
						>
					{/if}
				</p>
			</div>
		{/if}

		<!-- Rider tiles: camera and power fused — one grid, not three. -->
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
					class="bg-ink text-paper hover:bg-ink/90 rounded px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
					>Pair trainer and ride</button
				>
				{#if dev}
					<!-- Dev-only (#123): simulated watts in a live room would count for
					     medals, XP and streaks — the fairness layer takes no fakes. -->
					<button
						onclick={() =>
							ride(
								new SimulatedTrainer({
									baseWatts: profile.current.ftp * 0.75,
								}),
							)}
						class="border-muted/30 hover:border-muted/60 rounded border px-4 py-2 text-sm"
						>Ride simulated</button
					>
				{/if}

				{#if av.status === 'off' || av.status === 'failed'}
					<button
						onclick={() => av.join()}
						class="border-muted/30 hover:border-muted/60 rounded border px-4 py-2 text-sm"
						>Join voice</button
					>
				{:else}
					<!-- In voice: the controls live where you are (#181 feedback),
					     not only off in the side navigation. -->
					<button
						onclick={() => av.toggleMic()}
						class="rounded border px-4 py-2 text-sm {av.micOn
							? 'border-z4/50 text-ink'
							: 'border-z6/50 text-z6'}">{av.micOn ? 'Mute' : 'Unmute'}</button
					>
					<button
						onclick={() => av.toggleCam()}
						class="border-muted/30 hover:border-muted/60 rounded border px-4 py-2 text-sm"
						>{av.camOn ? 'Cam off' : 'Cam on'}</button
					>
					<button
						onclick={() => av.leave()}
						class="border-muted/30 text-muted hover:border-muted/60 hover:text-ink rounded border px-4 py-2 text-sm"
						>Leave voice</button
					>
				{/if}
				{#if canControl && shared?.phase === 'idle' && !live.tick?.game && setupPicked}
					<button
						onclick={() => startWorkout(setupPicked.workout)}
						class="bg-ink text-paper hover:bg-ink/90 rounded px-4 py-2 text-sm font-medium"
						>Start {setupPicked.workout.name}</button
					>
					{#if av.error}<span class="text-muted text-xs">{av.error}</span>{/if}
				{/if}
				{#if rideError}<span class="text-z6 text-xs">{rideError}</span>{/if}
			</div>
		{/if}

		{#if phase === 'lounge' && upcoming.length > 0}
			<!-- The plan, phrased like a plan (#181 feedback): what, when, how
			     long, whose idea — a card, not a floating row of monospace. -->
			<div
				class="border-neon/30 bg-surface-raised mt-4 max-w-2xl rounded-lg border"
			>
				{#each upcoming as entry, i (entry.id)}
					<div
						class="border-ink/5 flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-3 last:border-b-0"
					>
						<div class="min-w-0 flex-1">
							<p class="text-muted text-[10px] tracking-[0.2em] uppercase">
								{i === 0 ? 'next session in this room' : 'after that'}
							</p>
							<p class="font-display truncate text-base font-bold">
								{entry.workoutName}
							</p>
							<p class="text-muted mt-0.5 text-xs">
								{formatWhen(entry.startsAt)} ·
								{Math.round(
									parseSharedSegments(entry.workoutJson).reduce(
										(t, seg) => Math.max(t, seg.startSeconds + seg.seconds),
										0,
									) / 60,
								)} min · planned by {entry.createdBy}
							</p>
						</div>
						<span class="flex shrink-0 items-center gap-3">
							{#if due(entry.startsAt)}
								{#if canControl}
									<button
										onclick={() => startScheduled(entry)}
										class="bg-ink text-paper hover:bg-ink/90 rounded px-4 py-2 text-xs font-semibold"
										>Start now</button
									>
								{:else}
									<span class="text-watt glow-text text-xs">starting soon</span>
								{/if}
							{/if}
							{#if canControl}
								<button
									onclick={() => onUnschedule(entry.id)}
									class="text-muted hover:text-ink text-[11px] underline"
									>remove</button
								>
							{/if}
						</span>
					</div>
				{/each}
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

		{#if shared?.phase === 'done' && mySamples.length >= 60 && !summaryDismissed}
			<div class="border-muted/15 bg-surface-raised mt-3 rounded-lg border p-6">
				<SessionSummary
					subtitle="{roomName} · {shared.workoutName} · {new Date().toLocaleDateString()}"
					samples={mySamples}
					ftp={you.ftp}
					execution={you.execution}
					medal={myMedal}
					{roomName}
				>
					{#snippet actions()}
						<button
							onclick={() => (summaryDismissed = true)}
							class="border-muted/30 hover:border-muted/60 rounded border px-4 py-2.5 text-sm"
							>Back to the lounge</button
						>
					{/snippet}
				</SessionSummary>
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
				<div class="text-right">
					<span
						class="font-display text-lg leading-none font-semibold {ZONE_TEXT[
							myZone
						]}">Z{myZone}</span
					>
					<span class="text-muted ml-1 text-[10px] tracking-wider uppercase"
						>zone</span
					>
				</div>
			</div>
			{#if trainer && hrSource}
				<p class="text-muted mt-1 text-right text-[10px]">
					{#if profile.current.shareHr}
						Sharing heart rate from your {hrSource === 'heart-rate'
							? 'strap'
							: 'trainer'} ·
						<button
							onclick={() => profile.update({ shareHr: false })}
							class="hover:text-ink underline">stop sharing</button
						>
					{:else}
						Heart rate not shared with this room ·
						<button
							onclick={() => profile.update({ shareHr: true })}
							class="hover:text-ink underline">share</button
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
					<IntervalStrip
						{block}
						{bias}
						cadence={you.cadence}
						hr={you.hr}
						onBias={trainer ? nudgeBias : undefined}
					/>
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

	<div class="hidden shrink-0 xl:block">
		<SidePanel
			live={phase === 'live'}
			showPlayer={layout !== 'media' &&
				(!!live.tick?.jukebox?.current || !!live.tick?.jukebox?.jamUrl)}
			queue={queueView}
			onAdd={(url) => void addYouTubeUrl(url, live.jukebox)}
			onJam={(url) => live.jukebox('jam', undefined, undefined, url)}
			jamUrl={live.tick?.jukebox?.jamUrl}
			messages={live.chatLog}
			reactions={live.chatReactions}
			myReacts={live.myReacts}
			onReact={(id, emoji) => live.react(id, emoji)}
			onCheer={(emoji) => live.cheer(emoji)}
			onChat={(text) => live.chat(text)}
		>
			{#snippet player()}
				<Jukebox
					jukebox={live.tick?.jukebox}
					send={(action, videoId, title, jamUrl, positionSec) =>
						live.jukebox(action, videoId, title, jamUrl, positionSec)}
					ducked={Object.entries(av.speaking).some(
						([id, active]) => active && id !== account.me?.id,
					)}
				/>
			{/snippet}
		</SidePanel>
	</div>
</div>
