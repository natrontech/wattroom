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
	import SessionSummary from '$lib/ride/SessionSummary.svelte';
	import type { Medal } from '$lib/components/MedalCard.svelte';
	import type { RoomEvent } from '$lib/protocol';
	import { setRoomContext } from '$lib/room/context';
	import { stageSlot } from '$lib/room/stage-slot.svelte';

	interface AdminMember {
		id: string;
		displayName: string;
		role: string;
		avatarUrl?: string;
		avatarPreset?: string;
		totalXp?: number;
		ftpWatts?: number;
		weightKg?: number;
		joinedAt?: string;
	}
	interface AdminMedal {
		kind: string;
		rider: string;
		awardedAt: string;
	}
	let {
		children,
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
		/** The place standing in the content column. */
		children: import('svelte').Snippet;
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

	// ADR-0020: the shell keeps the state, the places render the surface.
	setRoomContext({
		get slug() {
			return slug;
		},
		get roomName() {
			return roomName;
		},
		get icon() {
			return icon;
		},
		get code() {
			return code;
		},
		get cheers() {
			return cheers;
		},
		get riders() {
			return riders;
		},
		get you() {
			return you;
		},
		get block() {
			return block;
		},
		get segments() {
			return segments;
		},
		get workout() {
			return parsed.workout;
		},
		get shared() {
			return shared;
		},
		get phase() {
			return phase;
		},
		get canControl() {
			return canControl;
		},
		get myRole() {
			return myRole;
		},
		get sprint() {
			return live.tick?.sprint;
		},
		get game() {
			return live.tick?.game;
		},
		get bias() {
			return bias;
		},
		nudgeBias,
		get trainer() {
			return trainer;
		},
		get hrSource() {
			return hrSource;
		},
		get rideError() {
			return rideError;
		},
		pair: () => void ride(new FtmsTrainer()),
		pairSimulated: () =>
			void ride(
				new SimulatedTrainer({ baseWatts: profile.current.ftp * 0.75 }),
			),
		unpair,
		control: (kind, payload, id) =>
			live.control(kind as never, payload as never, id),
		openPicker: (intent = 'start') => {
			setupIntent = intent;
			setup = true;
		},
		openTv: () => (tv = true),
		get stageSources() {
			return stageSources;
		},
		get onStage() {
			return onStage;
		},
		pickStage: (key) => av.setStage(key),
		attachStage: (node, key) => av.attachStage(node, key),
		attachVideo: (id, node) => av.attach(id, node),
		videoOf: (id) => av.videoOf[id],
		get focusId() {
			return focusId;
		},
		setFocus: (id) => (focusId = id),
		get upcoming() {
			return upcoming;
		},
		get icsToken() {
			return icsToken;
		},
		get streakWeeks() {
			return streakWeeks;
		},
		get monthKj() {
			return monthKj;
		},
		get adminBusy() {
			return adminBusy;
		},
		get members() {
			return members;
		},
		get medals() {
			return medals;
		},
		schedule: (name, json, at) => onSchedule(name, json, at),
		reschedule: (id, at) => onReschedule(id, at),
		unschedule: (id) => onUnschedule(id),
		rotateIcs: () => onRotateIcs(),
		setRole: (userId, next) => onRole(userId, next),
		removeMember: (userId) => onRemove(userId),
		startScheduled,
		copyIcsUrl,
		get reminders() {
			return reminders;
		},
	});

	// ── Session setup (#115, redesigned as SessionPicker) ─────────────────────
	let setup = $state(false);
	let setupIntent = $state<'start' | 'plan'>('start');
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
		buildShelf(custom.all)
			.map((entry) => ({
				...entry,
				recent: recency.has(entry.workout.name),
			}))
			.sort(
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
		intent={setupIntent}
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

<!-- The sidebar is the layout's (ADR-0020 — one instance across navigation);
     the room is content | people inside that frame. -->
<div class="bg-surface text-ink flex h-full overflow-hidden">
	<main class="relative flex min-w-0 flex-1 flex-col overflow-hidden">
		<CheerLayer cheers={live.tick?.cheers} />

		<!-- Room-level status belongs to the shell, not to a place: a dropped
		     connection is true on every one of them, and errors.md wants it
		     persistent rather than a toast the rider will not see. -->
		{#if live.status !== 'live'}
			<div class="shrink-0 px-5 pt-4">
				<FaultBanner
					fault={{ kind: 'room', state: 'reconnecting' }}
					bufferedSeconds={droppedAt
						? Math.round((Date.now() - droppedAt) / 1000)
						: 0}
					onRecover={() => location.reload()}
				/>
			</div>
		{:else if av.status === 'reconnecting'}
			<!-- Media gapped while the SDK retries (#234). -->
			<div class="shrink-0 px-5 pt-4">
				<FaultBanner
					fault={{ kind: 'voice', state: 'reconnecting' }}
					bufferedSeconds={0}
					onRecover={() => void av.join()}
				/>
			</div>
		{/if}

		{#if shared?.phase === 'paused'}
			<div class="shrink-0 px-5 pt-4">
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

		<!-- The jukebox dock floats over this column's bottom-right and RMF
		     says nothing may cover the player — so the content reserves the
		     dock's footprint rather than the player sitting on live data.
		     Seated on the lounge's stage it is content, and needs no gutter. -->
		<div
			class="min-h-0 flex-1 overflow-y-auto"
			style={live.tick?.jukebox?.current && !stageSlot.seat
				? 'padding-bottom: calc(var(--pane-jukebox-dock-h, 308px) + 1.5rem)'
				: ''}
		>
			{@render children()}
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
		{riders}
		onQueue={(url) => void addYouTubeUrl(url, live.jukebox)}
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
