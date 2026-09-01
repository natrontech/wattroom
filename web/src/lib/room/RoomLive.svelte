<script lang="ts">
	import { dev } from '$app/environment';
	import { page } from '$app/state';
	import {
		LogOut as LeaveIcon,
		MessageSquare,
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
	import { play, playCountdownTick, setMuted } from '$lib/sound/cues';
	import { account } from '$lib/account.svelte';
	import { api } from '$lib/api';
	import { arbitrate } from '$lib/ble/arbitrate';
	import { FtmsTrainer } from '$lib/ble/ftms';
	import { SimulatedTrainer } from '$lib/ble/simulated';
	import type { Trainer } from '$lib/ble/trainer';
	import { sensors } from '$lib/sensors.svelte';
	import { formatClock, formatWhen } from '$lib/format';
	import { createProfileStore } from '$lib/profile.svelte';
	import { flatten, targetAt } from '$lib/workout/engine';
	import { buildShelf } from '$lib/workout/shelf';
	import { roomConnection } from '$lib/room/connection.svelte';
	import { toasts } from '$lib/toast.svelte';
	import { pickStage } from '$lib/room/stage';
	import { parseSharedSegments, parseSharedWorkout } from '$lib/room/workout';
	import { addYouTubeUrl } from '$lib/room/jukebox-add';
	import { wireMetrics } from '$lib/room/wire';
	import { describeBlock, type RoomRider } from '$lib/room/view';
	import WhenPicker from '$lib/components/WhenPicker.svelte';
	import { toLocalInput } from '$lib/components/when';
	import CheerLayer from '$lib/room/CheerLayer.svelte';
	import FaultBanner from '$lib/room/FaultBanner.svelte';
	import Jukebox from '$lib/room/Jukebox.svelte';
	import RiderTile from '$lib/room/RiderTile.svelte';
	import { createCustomStore } from '$lib/workout/custom.svelte';
	import Banner from '$lib/components/Banner.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import RoomTraining from '$lib/room/RoomTraining.svelte';
	import SessionPicker from '$lib/room/SessionPicker.svelte';
	import SidePanel from '$lib/room/SidePanel.svelte';
	import Stage from '$lib/room/Stage.svelte';
	import TvMode from '$lib/room/TvMode.svelte';
	import RoomAdmin from '$lib/room/RoomAdmin.svelte';
	import SessionSummary from '$lib/ride/SessionSummary.svelte';
	import type { Medal } from '$lib/components/MedalCard.svelte';
	import type { RoomEvent } from '$lib/protocol';

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
		icon = '',
		cheers = undefined,
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
		onReschedule,
		onUnschedule,
		icsToken = '',
		onRotateIcs,
	}: {
		slug: string;
		role: string;
		roomName: string;
		/** Owner-set emoji identity mark (#223). */
		icon?: string;
		/** The room's reaction palette (#223); absent = SidePanel's base set. */
		cheers?: string[];
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
		onReschedule: (id: string, startsAt: string) => void;
		onUnschedule: (id: string) => void;
		/** Secret calendar-feed token (#245); '' hides the subscribe affordance. */
		icsToken?: string;
		onRotateIcs: () => void;
	} = $props();

	// #173: the connection outlives this page — you stay in the room while
	// you browse. Leaving is the rail's explicit button, never unmount.
	// svelte-ignore state_referenced_locally
	const connection = roomConnection.join(slug);
	const live = connection.live;
	const av = connection.av;
	// The rail's "voice is busy" link lands you IN the channel, not next to it
	// (#251): ?voice=1 auto-joins once on mount; join() is idempotent.
	if (page.url.searchParams.has('voice') && account.me?.avEnabled)
		void av.join();
	const profile = createProfileStore();
	onDestroy(() => {
		stopRiding();
	});

	// Space is push-to-talk while that mode is on — never while typing.

	// The room's pack governs the cue mixer while you are here ('silent' =
	// visual cues only); leaving restores sound for the rest of the app.
	$effect(() => {
		if (soundPack === 'silent') {
			setMuted(true);
			return () => setMuted(false);
		}
	});

	// Roles change while you stand in the room: the tick's roster carries the
	// new one, the page's fetched prop is frozen at open (rider report).
	const myRole = $derived(
		live.tick?.roster.find((rider) => rider.id === account.me?.id)?.role ??
			role,
	);
	const canControl = $derived(myRole === 'owner' || myRole === 'coach');
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
			// The server drains its metrics map every tick, so a 1 Hz trainer
			// misses a 1 Hz tick constantly — treating every gap as a fault
			// flickered "no signal" and zeroed live watts between beats.
			// Last-known values ride through the gap; only real silence reads
			// as no signal.
			const gap = known ? now - known.at : Infinity;
			const held = !metrics && gap < 30_000 ? known : undefined;
			const stale = !!held && gap >= 5_000;
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
				watts: metrics?.watts ?? held?.watts ?? 0,
				cadence: metrics?.cadence ?? held?.cadence ?? 0,
				hr: metrics?.hr ?? held?.hr ?? 0,
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

	// ── One view, focus instead of layouts (#181 feedback) ───────────────────
	// The Metrics/Video/Media tabs are gone: tiles always fuse camera and
	// metrics, media lives in the panel/dock, and tapping a tile spotlights
	// that rider. Ephemeral by design — a focus is a glance, not a preference.
	let tv = $state(false);
	let focusId = $state<string | null>(null);
	// The stage's menu, named (#280): av knows the tracks, only this page
	// knows whose they are.
	// The jukebox video is a stage source, and it leads (#316): what the room
	// is watching together belongs in the room, never in a window pasted over
	// the cam grid. A rider who wants a share instead picks it.
	const stageSources = $derived([
		...(live.tick?.jukebox?.current
			? [
					{
						key: 'jukebox',
						kind: 'jukebox' as const,
						gen: live.tick.jukebox.current.videoId,
						label: live.tick.jukebox.current.title || 'the jukebox',
					},
				]
			: []),
		...av.stageSources.map((source) => ({
			key: source.key,
			kind: source.kind,
			gen: String(source.gen),
			label:
				(riders.find((rider) => rider.id === source.id)?.name ?? 'someone') +
				(source.kind === 'screen' ? "'s screen" : ''),
		})),
	]);
	const onStage = $derived(pickStage(stageSources, av.stagePick));
	const focused = $derived(riders.find((rider) => rider.id === focusId));
	const others = $derived(riders.filter((rider) => rider.id !== focusId));

	// ── Sounds follow state (riders are not watching) ─────────────────────────
	// Cue ducking + the music-aware gate threshold moved to the room
	// connection (#216) — they must work on every page, not just this one.
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
			playCountdownTick(left);
		}
	});

	// ── Coach controls ────────────────────────────────────────────────────────
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

	// ── Session setup (#115, redesigned as SessionPicker) ─────────────────────
	let setup = $state(false);
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
		buildShelf(custom.all).sort(
			(a, b) =>
				(recency.get(a.workout.name) ?? 999) -
				(recency.get(b.workout.name) ?? 999),
		),
	);
	// The quick-start on the lounge floor offers the most recently ridden.
	const setupPicked = $derived(shelf[0]);

	// ── Planned rides (#116) ──────────────────────────────────────────────────
	/** Startable a little early and through the grace the server keeps it visible. */
	function due(iso: string): boolean {
		const diff = new Date(iso).getTime() - Date.now();
		return diff < 10 * 60 * 1000 && diff > -30 * 60 * 1000;
	}
	// A pasted image uploads first (#279); the line then carries only its id.
	async function sendChatLine(text: string, image?: Blob) {
		if (!image) {
			live.chat(text);
			return;
		}
		const up = await api<{ id: string }>(`/api/rooms/${slug}/chat/images`, {
			method: 'POST',
			body: image,
			headers: { 'content-type': image.type },
		});
		if (!up.ok) {
			toasts.push(up.error.message, { tone: 'error' });
			return;
		}
		live.chat(text, up.data.id);
	}

	function copyIcsUrl() {
		void navigator.clipboard.writeText(
			`${location.origin}/api/rooms/${slug}/calendar/${icsToken}.ics`,
		);
		toasts.push(
			'Calendar link copied — subscribe "from URL" in your calendar app.',
		);
	}

	// Moving a plan (#258): "move" folds a WhenPicker out under the card row.
	let movingId = $state<string | null>(null);
	let moveAt = $state('');
	function openMove(entry: (typeof upcoming)[number]) {
		movingId = movingId === entry.id ? null : entry.id;
		moveAt = toLocalInput(new Date(entry.startsAt));
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
	/** Re-pairing is one button (rider report): drop the trainer and release
	 *  its subscription, keeping the ride buffer open so a fresh pair
	 *  continues the same session. */
	function unpair() {
		unsubscribe?.();
		unsubscribe = undefined;
		void trainer?.setTargetPower(0);
		void trainer?.disconnect();
		trainer = null;
		rideError = null;
	}
	function stopRiding() {
		live.finish();
		unpair();
	}

	// ── Connection fault + jukebox helpers ────────────────────────────────────
	let droppedAt = $state<number | null>(null);
	$effect(() => {
		if (live.status === 'reconnecting' && droppedAt === null)
			droppedAt = Date.now();
		if (live.status === 'live') droppedAt = null;
	});
	const currentTitle = $derived(live.tick?.jukebox?.current?.title ?? '');

	// ── The main column is two places, not one scroll (#359) ─────────────────
	// The stage sits in the middle of the room now, which pushed every number a
	// session has below the fold. Room is the stage and the tiles; Training is
	// the clock, the block, the target and the graph. The stage unmounts with
	// the tab and the jukebox dock takes the picture back into its floating
	// player, so the room keeps watching while you ride.
	let view = $state<'room' | 'training'>('room');
	// Riders are not watching the tab bar: a session starting takes you to your
	// numbers (ux.md — state changes announce themselves). Leaving it is a
	// click, and nothing drags you back.
	let sawPhase: typeof phase = 'lounge';
	$effect(() => {
		if (phase !== 'lounge' && sawPhase === 'lounge') view = 'training';
		sawPhase = phase;
	});

	// The one timeline line no server sends (#359): the hub does not know the
	// schedule, so the reminder is derived here from the same list the plan
	// card renders, off the tick's clock so it appears without a reload.
	const REMINDER_LEAD_MS = 10 * 60_000;
	const reminders = $derived.by((): RoomEvent[] => {
		const now = live.tick?.at ?? Date.now();
		return upcoming
			.filter((entry) => {
				const gap = new Date(entry.startsAt).getTime() - now;
				return gap < REMINDER_LEAD_MS && gap > -30 * 60_000;
			})
			.map((entry) => {
				const at = new Date(entry.startsAt).getTime();
				return {
					id: `due:${entry.id}`,
					kind: 'session',
					verb: 'due',
					subject: entry.workoutName,
					when: at,
					count: 1,
					// Pinned where it comes due, not where it was computed: the
					// line must not walk down the log as the clock ticks.
					at: at - REMINDER_LEAD_MS,
				};
			});
	});
	let admin = $state(false);
	let chatSheet = $state(false);

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
		if (e.key === 'Escape') {
			tv = false;
			setup = false;
			chatSheet = false;
			focusId = null;
		}
	}}
/>

{#if tv}
	<!-- TV mode is the cave whatever the theme says — it exists for the ride. -->
	<div class="cave bg-surface fixed inset-0 z-50">
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
	<SessionPicker
		{shelf}
		ftp={profile.current.ftp}
		busy={adminBusy}
		gameRunning={!!live.tick?.game}
		onStart={(workout) => startWorkout(workout)}
		onPlan={(name, json, at) => {
			onSchedule(name, json, at);
			setup = false;
		}}
		onStartGame={(id) => {
			live.control('game', undefined, id);
			setup = false;
		}}
		onClose={() => (setup = false)}
	/>
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

{#if shared?.phase === 'done' && mySamples.length >= 60 && !summaryDismissed}
	<!-- The summary has to call out (#359). It used to render at the bottom of
	     the main column, so a session ended while you were looking at the stage
	     and nothing said so — a modal is the room telling you it is over. -->
	<Modal
		label="Session summary"
		class="max-h-[88dvh] max-w-5xl overflow-y-auto"
		onclose={() => (summaryDismissed = true)}
	>
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
					class="btn btn-secondary">Back to the lounge</button
				>
			{/snippet}
		</SessionSummary>
	</Modal>
{/if}

<!-- The rail is the layout's (#191 — one instance across navigation);
     this page is main | panel inside that frame. -->
<div class="bg-surface text-ink flex h-full overflow-hidden">
	<main
		class="relative flex min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-5 py-4"
	>
		<CheerLayer cheers={live.tick?.cheers} />

		<header class="flex flex-wrap items-center gap-x-5 gap-y-2 pb-4">
			<div>
				<h1 class="font-display text-lg leading-tight font-bold">
					{icon ? `${icon} ` : ''}{roomName}
				</h1>
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

			<button
				onclick={() => (tv = true)}
				class="border-muted/20 text-muted hover:text-ink ml-auto inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs"
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
					<button onclick={() => (setup = true)} class="btn btn-primary"
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
		<!-- Two places, not one scroll (#359). The stage is the room's middle
		     now, so the session's own numbers get a tab of their own instead of
		     a thousand pixels of scrollback under the tiles. -->
		<!-- Sized for a sweating rider at arm's length (ux.md), not a desk: the
		     one control you reach for mid-ride cannot be a 12px label. -->
		<div class="border-ink/5 mb-3 flex items-center border-b">
			{#each [{ id: 'room' as const, label: 'Room' }, { id: 'training' as const, label: 'Training' }] as tab (tab.id)}
				<button
					onclick={() => (view = tab.id)}
					aria-current={view === tab.id ? 'page' : undefined}
					class="-mb-px border-b-2 px-7 py-4 text-base font-medium {view ===
					tab.id
						? 'border-neon text-ink'
						: 'text-muted hover:text-ink border-transparent'}"
				>
					{tab.label}
					{#if tab.id === 'training' && phase !== 'lounge'}
						<!-- Live data is the only thing that carries the accent (ADR-0005). -->
						<span
							class="bg-watt ml-1.5 inline-block h-2 w-2 animate-pulse rounded-full align-middle"
						></span>
					{/if}
				</button>
			{/each}
			{#if phase === 'live' && shared}
				<!-- The clock stays readable from the room tab: leaving your
				     numbers should not mean losing the time. -->
				<span class="font-display text-muted ml-auto pr-2 text-lg tabular-nums"
					>{formatClock(shared.elapsed)}</span
				>
			{/if}
		</div>

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
		{:else if av.status === 'reconnecting'}
			<!-- Media gapped while the SDK retries (#234) — the room banner
			     above already covers voice when the whole connection is down. -->
			<div class="mb-3">
				<FaultBanner
					fault={{ kind: 'voice', state: 'reconnecting' }}
					bufferedSeconds={0}
					onRecover={() => void av.join()}
				/>
			</div>
		{/if}

		{#if shared?.phase === 'paused'}
			<div class="mb-3">
				<Banner tone="warn">
					<p class="flex items-center gap-3 text-xs">
						<span class="bg-z5 h-2 w-2 shrink-0 animate-pulse rounded-full"
						></span>
						<span>
							<span class="font-medium">The session is paused.</span>
							<span class="text-muted"
								>Targets are released — spin easy until the coach resumes.</span
							>
						</span>
					</p>
				</Banner>
			</div>
		{/if}

		{#if view === 'room'}
			{#if onStage}
				<!-- The stage (#280): many people may share at once, so the picker
			     below chooses; the frame zooms, pans, resizes and pops out. -->
				<Stage
					sources={stageSources}
					activeKey={onStage.key}
					trackKey={`${onStage.key}:${onStage.gen}`}
					onPick={(key) => av.setStage(key)}
					attach={(node) => av.attachStage(node, onStage.key)}
				/>
			{/if}

			<!-- Rider tiles: camera and metrics fused, ONE grid (#181 feedback) —
		     tap a tile to spotlight that rider, tap again to let go. -->
			{#snippet tile(rider: RoomRider)}
				<RiderTile
					{rider}
					{phase}
					videoKey={av.videoOf[rider.id]}
					videoAttach={av.videoOf[rider.id]
						? (node) => av.attach(rider.id, node)
						: undefined}
				/>
			{/snippet}
			{#if focused}
				<button
					onclick={() => (focusId = null)}
					class="block w-full max-w-3xl text-left"
					title="tap to unfocus"
				>
					{@render tile(focused)}
				</button>
				{#if others.length > 0}
					<div
						class="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4 xl:grid-cols-6"
					>
						{#each others as rider (rider.id)}
							<button
								onclick={() => (focusId = rider.id)}
								class="block text-left"
								title="focus {rider.name}"
							>
								{@render tile(rider)}
							</button>
						{/each}
					</div>
				{/if}
			{:else}
				<div class="grid shrink-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
					{#each riders as rider (rider.id)}
						<button
							onclick={() => (focusId = rider.id)}
							class="block text-left"
							title="focus {rider.name}"
						>
							{@render tile(rider)}
						</button>
					{/each}
				</div>
			{/if}
		{:else}
			<RoomTraining
				{phase}
				workoutName={shared?.workoutName ?? ''}
				countdown={shared?.countdownRemaining ?? 0}
				elapsed={shared?.elapsed ?? 0}
				total={shared?.totalSeconds ?? 0}
				{segments}
				{riders}
				{you}
				{block}
				{bias}
				onBias={trainer ? nudgeBias : undefined}
				lthr={profile.current.lthr}
				{hrSource}
				shareHr={profile.current.shareHr}
				onShareHr={(on) => profile.update({ shareHr: on })}
				sprint={live.tick?.sprint}
				game={live.tick?.game}
				roster={live.tick?.roster ?? []}
				{canControl}
				onEndGame={() => live.control('game-end')}
				onPick={() => (setup = true)}
			/>
		{/if}
		<!-- Outside the tabs on purpose: what the room is doing next is the
	     room's business on either of them (rider report). -->
		{#if phase === 'lounge' && (upcoming.length > 0 || icsToken)}
			<!-- The plan, phrased like a plan (#181 feedback): what, when, how
		     long, whose idea — a card, not a floating row of monospace. The
		     card also shows with nothing in it (#325): the subscribe link
		     used to be hidden behind having a plan already. -->
			<div
				class="border-neon/30 bg-surface-raised mt-4 max-w-2xl rounded-lg border"
			>
				{#each upcoming as entry, i (entry.id)}
					<div
						class="border-ink/5 flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-3 last:border-b-0"
					>
						<div class="min-w-0 flex-1">
							<p class="eyebrow">
								{i === 0 ? 'next session in this room' : 'after that'}
							</p>
							<p class="font-display truncate text-base font-bold">
								{entry.workoutName}
							</p>
							<p class="text-muted mt-0.5 text-xs">
								{formatWhen(entry.startsAt, true)} ·
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
										class="btn btn-primary">Start now</button
									>
								{:else}
									<span class="text-watt glow-text text-xs">starting soon</span>
								{/if}
							{/if}
							{#if canControl}
								<button
									onclick={() => openMove(entry)}
									class="text-muted hover:text-ink text-[11px] underline"
									>move</button
								>
								<button
									onclick={() => onUnschedule(entry.id)}
									class="text-muted hover:text-ink text-[11px] underline"
									>remove</button
								>
							{/if}
						</span>
						{#if canControl && movingId === entry.id}
							<div class="flex w-full flex-wrap items-center gap-2 pt-1">
								<WhenPicker bind:value={moveAt} />
								<button
									onclick={() => {
										onReschedule(entry.id, new Date(moveAt).toISOString());
										movingId = null;
									}}
									disabled={adminBusy || !moveAt}
									class="btn btn-secondary btn-xs disabled:opacity-40"
									>Move</button
								>
							</div>
						{/if}
					</div>
				{/each}
				{#if upcoming.length === 0}
					<p class="text-muted px-4 py-3 text-xs">
						Nothing planned in this room yet — <em>Pick a workout</em>, then
						plan it for later instead of starting it.
					</p>
				{/if}
				{#if icsToken}
					<div
						class="border-ink/5 flex flex-wrap items-center gap-4 border-t px-4 py-2"
					>
						<a
							href="/sessions"
							class="text-muted hover:text-ink text-[11px] underline"
							>all your sessions</a
						>
						<button
							onclick={copyIcsUrl}
							class="text-muted hover:text-ink text-[11px] underline"
							>subscribe to this room</button
						>
						{#if role === 'owner'}
							<button
								onclick={() => {
									onRotateIcs();
									toasts.push(
										'Calendar link reset — shared links stop working.',
									);
								}}
								class="text-muted hover:text-ink text-[11px] underline"
								>reset link</button
							>
						{/if}
					</div>
				{/if}
			</div>
		{/if}
		<!-- Pairing must never take voice and camera with it: this row stayed
		     hidden for the whole ride once a trainer connected, which also left
		     no way to re-pair one that dropped (rider report). -->
		<div class="mt-3 flex flex-wrap items-center gap-2">
			{#if !trainer}
				<button
					onclick={() => ride(new FtmsTrainer())}
					disabled={typeof navigator === 'undefined' || !navigator.bluetooth}
					class="btn btn-primary">Pair trainer and ride</button
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
						class="btn btn-secondary">Ride simulated</button
					>
				{/if}
			{:else}
				<button onclick={unpair} class="btn btn-secondary"
					>Unpair trainer</button
				>
			{/if}

			{#if !account.me?.avEnabled}
				<!-- No LiveKit configured: voice is not a thing here, so no
					     button that would 404 (#219, capability gating). -->
			{:else if av.status === 'off' || av.status === 'failed'}
				<button onclick={() => av.join()} class="btn btn-secondary"
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
				<button onclick={() => av.toggleCam()} class="btn btn-secondary"
					>{av.camOn ? 'Cam off' : 'Cam on'}</button
				>
				<button
					onclick={() => void av.toggleShare()}
					class="btn btn-secondary inline-flex items-center gap-1.5"
				>
					{#if av.sharing}<ScreenShareOff size={14} /> Stop sharing{:else}<ScreenShare
							size={14}
						/> Share screen{/if}
				</button>
				<button
					onclick={() => av.leave()}
					class="border-muted/30 text-muted hover:border-muted/60 hover:text-ink rounded border px-4 py-2 text-sm"
					>Leave voice</button
				>
			{/if}
			{#if canControl && shared?.phase === 'idle' && !live.tick?.game && setupPicked}
				<button
					onclick={() => startWorkout(setupPicked.workout)}
					class="btn btn-primary">Start {setupPicked.workout.name}</button
				>
				{#if av.error}<span class="text-muted text-xs">{av.error}</span>{/if}
			{/if}
			{#if rideError}<span class="text-z6 text-xs">{rideError}</span>{/if}
		</div>
	</main>

	<div class="hidden shrink-0 xl:block">
		{@render panel()}
	</div>
</div>

<!-- Below xl the panel becomes a summonable sheet — the blips were firing
     for a chat no laptop-sized window could open (#219). -->
<button
	onclick={() => (chatSheet = true)}
	class="bg-surface-raised ring-ink/15 fixed right-4 bottom-4 z-40 grid h-12 w-12 place-items-center rounded-full shadow-lg ring-1 xl:hidden"
	aria-label="open chat"
>
	<MessageSquare size={18} />
</button>
{#if chatSheet}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div
		class="bg-paper/50 fixed inset-0 z-50 xl:hidden"
		onclick={(e) => e.target === e.currentTarget && (chatSheet = false)}
	>
		<div class="bg-surface absolute inset-y-0 right-0 shadow-2xl">
			{@render panel()}
		</div>
	</div>
{/if}

{#snippet panel()}
	<SidePanel
		live={phase === 'live'}
		messages={live.chatLog}
		events={[...live.roomEvents, ...reminders]}
		reactions={live.chatReactions}
		myReacts={live.myReacts}
		onReact={(id, emoji) => live.react(id, emoji)}
		onCheer={(emoji) => live.cheer(emoji)}
		onChat={(text, image) => void sendChatLine(text, image)}
		{slug}
		{cheers}
	>
		{#snippet player()}
			<Jukebox jukebox={live.tick?.jukebox} send={live.jukebox} />
		{/snippet}
	</SidePanel>
{/snippet}
