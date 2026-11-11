import { untrack } from 'svelte';
import { placeOnRoad } from '#lib/channel/road-place.ts';
import { roadOf } from '#lib/workout/road-workout.ts';
import { roadHash } from '#lib/road/road.ts';
import { rememberRodeIn } from '#lib/crew-lounge.ts';
import { account } from '#lib/account.svelte.ts';
import { createProfileStore } from '#lib/profile.svelte.ts';
import { spaceBelongsTo } from '#lib/channel/ptt-keys.ts';
import { gearsEnabled } from '#lib/ride/gears-enabled.ts';
import { EASIER_HARDER_OFF, shiftAnswer } from '#lib/ride/easier-harder.ts';
import { bindShifters, createRemoteRunner } from '#lib/ride/keys.ts';
import { offeredActions, viewNow } from '#lib/ride/ride-offers.svelte.ts';
import { createRemoteWorld } from '#lib/channel/remote-world.ts';
import { createTalkOpener } from '#lib/ride/remote-talk.ts';
import { clockActions, pauseOf } from '#lib/ride/remote-blocks.ts';
import { shifterSlot } from '#lib/ble/controller-slot.svelte.ts';
import { DEFAULTS } from '#lib/workout/guards.ts';
import { createRideShift, type RideShift } from '#lib/ride/ride-shift.ts';
import { pullProfile } from '#lib/profile-sync.svelte.ts';
import { createChannelLive } from '#lib/channel/live.svelte.ts';
import { createRecording } from '#lib/session/recording.svelte.ts';
import {
	channelRide,
	type ChannelRide,
	type ChannelRideDeps,
} from '#lib/ride/channel-ride.svelte.ts';
import type { FreeRide } from '#lib/ride/free-ride.svelte.ts';
import { sensorClaim } from '#lib/channel/sensor-claim.ts';
import type { OwnRide } from '#lib/ride/own-ride.svelte.ts';
import { parseSharedWorkout } from '#lib/workout/shared.ts';
import { play } from '#lib/sound/cues.ts';
import { applyAway, noEcho, pressed } from '#lib/channel/away-echo.ts';
import { connectionCues } from '#lib/channel/connection-cues.svelte.ts';
import { bottleHandUps } from '#lib/channel/bottles.svelte.ts';
import { effortOf } from '#lib/roadside.ts';
import { followMoves } from '#lib/channel/follow-move.svelte.ts';
import { toasts } from '#lib/toast.svelte.ts';
import type { SessionState } from '#lib/protocol.ts';
import type { Segment, Workout } from '#lib/workout/types.ts';
import { listening } from '#lib/channel/listening.svelte.ts';
import { onPlacePath, type PlaceAddress } from '#lib/channel/address.ts';
import { isLivePhase } from '#lib/channel/tick-session.ts';
import { createVoiceRecovery } from '#lib/channel/voice-recover.ts';

/**
 * The voice channel you are IN (#173, ADR-0010's logical end): joining is a
 * STATE, not a page. The WS presence and the voice connection live here,
 * above the router — open /workouts, run a ramp test, ride solo, and you are
 * still in your voice channel, exactly like idling in a Discord server.
 * Leaving is an explicit act, never a navigation side-effect.
 *
 * One channel at a time: joining another leaves the first — you cannot stand
 * in two lounges.
 */
type Connection = {
	/** Where the connection stands, and every path that follows (#2449). */
	address: PlaceAddress;
	live: ReturnType<typeof createChannelLive>;
	av: ChannelAv;
	/**
	 * You stepped out, or came back (#706). One home for the pair the state
	 * needs (#807): the local AV and the hub message.
	 */
	/** reason is one of $lib/away's keys; '' is the plain away. */
	setAway: (next: boolean, reason?: string) => void;
	/** The rider's FTP/weight cache, pulled from the account (ADR-0009). */
	profile: ReturnType<typeof createProfileStore>;
	/** What you rode this session — the ride writes it, the summary reads it. */
	recording: ReturnType<typeof createRecording>;
	/** The trainer, and the targets it holds: `theRide`'s, never a page's (#521, ADR-0093). */
	ride: ChannelRide['ride'];
	/** Riding the channel with no session (ADR-0059) — beside the trainer. */
	freeRide: FreeRide;
	/** Your own workout, ridden beside the session (#2329). */
	ownRide: OwnRide;
	/** You are riding the channel's session, not standing beside it. */
	joined: () => boolean;
	/**
	 * You are riding on this connection: a live session you joined, your free
	 * ride recording or your own workout (ADR-0059, #2843). What the frame
	 * darkens for, the HUD follows and the leave guard protects. A spectator
	 * stays at the desk.
	 */
	riding: () => boolean;
	/** Easier / Harder acts on a ride here: the soundboard yields its keys (#3329). */
	shifting: () => boolean;
	/** The channel ride's one shifter: its keys and its on-screen pair press it (#3330). */
	shift: RideShift;
	/** The shared session and its workout, parsed once per connection. */
	shared: () => SessionState | undefined;
	segments: () => Segment[];
	workout: () => Workout | null;
	/** What the device's ride rides on while this place holds it. */
	rideDeps: ChannelRideDeps;
	dispose: () => void;
};

// The call you are in, and the crew session you ride (docs/SESSIONS.md):
// either can be held without the other.
// Raw: a connection is replaced whole, never written through, and the ride
// is told apart by the identity of its socket.
let current = $state.raw<Connection | null>(null);
let session = $state.raw<Connection | null>(null);
// How many ChannelStatus a page has mounted for the live place (#2986): the
// shell's and a session's layers each register theirs. The frame draws one
// exactly when a held ride has none — which a path cannot say, because a
// place's own page can fail to load and leave its path with no shell.
let statusShown = $state(0);

// The AV half loads with the channel, not with the shell (#1514): av.svelte.ts
// and what it pulls — device choices, the mic chain, the stage — were the
// biggest thing the root layout's closure carried for routes that never join
// a channel. The voice channel's and the session's layouts await
// prepareChannelAv() before the shell mounts, so join() stays synchronous
// for everything that reads the connection the moment it exists.
type ChannelAv = ReturnType<
	typeof import('#lib/channel/av.svelte.ts').createChannelAv
>;
let createChannelAv:
	typeof import('#lib/channel/av.svelte.ts').createChannelAv | null = null;
export async function prepareChannelAv(): Promise<void> {
	if (createChannelAv) return;
	({ createChannelAv } = await import('#lib/channel/av.svelte.ts'));
}

function connect(address: PlaceAddress): Connection {
	if (!createChannelAv) {
		throw new Error(
			'the channel AV is not loaded — the channel layout prepares it before the shell joins',
		);
	}
	const live = createChannelLive(address);
	// One rider, one voice (ADR-0089): the hub says which screen carries it.
	const av = createChannelAv(address, {
		claim: (take) => live.claimVoice(take),
		timedOut: () => live.voiceClaimTimedOut(),
		release: () => live.releaseVoice(),
	});
	// The device's one ride is held by one connection (ADR-0093): a crew
	// session's while you ride one, else the call's. The other reads it and
	// leaves the trainer, its claim and its keys alone.
	const holds = () => channelRide.current?.live === live;
	// Assigned inside the root below, which runs synchronously.
	let profile!: ReturnType<typeof createProfileStore>;
	let recording!: ReturnType<typeof createRecording>;
	let ride!: ChannelRide['ride'];
	let shift!: RideShift;
	let freeRide!: FreeRide;
	let ownRide!: OwnRide;
	let sharedOf!: () => SessionState | undefined;
	let segmentsOf!: () => Segment[];
	let workoutOf!: () => Workout | null;
	let rideDeps!: ChannelRideDeps;
	/**
	 * The away state this screen has asked for and not yet seen echoed
	 * (#1128), and when it asked. Null means "believe the roster". Outside the
	 * effect root because the button that writes it lives on the returned
	 * object, and the effect that reads it lives inside.
	 */
	/**
	 * What this screen pressed and has not yet seen echoed (#1128). Outside
	 * the effect root because the button that writes it lives on the returned
	 * object and the effect that reads it lives inside; the rule itself is in
	 * `away-echo.ts`, where it can be tested without an AV stack.
	 */
	let awayEcho = noEcho;

	/** You are riding the channel's session, not standing beside it. */
	const joined = () =>
		!!live.tick?.roster.find((r) => r.id === account.me?.id)?.inSession;

	const dispose = $effect.root(() => {
		// The trainer belongs to the connection, not to a page (#521). It is a
		// property of standing in the channel, exactly like the socket and the
		// call — and the channel's shell unmounting on the way to /workouts
		// used to disconnect it while you were still in the channel.
		//
		// It also gives the metrics stream one `seq` per session (#522): a
		// per-mount counter restarted at 1, and the server's ride record
		// dedupes by seq, so every sample after a return to the channel was
		// dropped as a duplicate. The tiles kept moving, which is why it read
		// as half-working; the execution meter and the saved ride did not.
		profile = createProfileStore();
		recording = createRecording({ ftp: () => profile.current.ftp });
		// The account is the truth for FTP and weight (ADR-0009). The root
		// layout pulls on boot; a connection that outlives many pages has to
		// pull too, or a ramp-measured FTP never reaches the session's targets.
		$effect(() => {
			if (account.me) pullProfile(profile);
		});

		const shared = $derived(live.tick?.state);
		const parsed = $derived(parseSharedWorkout(shared?.workoutJson));
		sharedOf = () => shared;
		segmentsOf = () => parsed.segments;
		workoutOf = () => parsed.workout;
		// Here and not in a page: the recording outlives every page (#2654).
		$effect(() => recording.follow(shared?.phase));

		// A race reads this at its flag (#3658): the hub has no other way to
		// know WattRoom, not the rider, holds the watts.
		$effect(() => live.setDrive(profile.current.singleSpeed));

		// The session's road under you, for the trainer (#3553): the cut
		// decoded once a pick, your place on it with every tick.
		const cut = $derived(parsed.workout ? roadOf(parsed.workout) : null);
		const place = $derived(placeOnRoad(live.tick, cut, account.me?.id ?? ''));
		// The trainer, the free ride and your own workout are the device's one
		// ride (ADR-0093): `theRide.channel` holds them, so a page that draws them is
		// a view and never their owner.
		// A crew session always takes the ride; a call takes it only when no
		// session holds one. Taking it moves it, still running (#4259): the
		// free ride is never ended by opening a place.
		rideDeps = {
			live,
			profile,
			recording,
			shared: () => shared,
			segments: () => parsed.segments,
			road: () => place,
			joined,
		};
		const sessionHolds =
			!!session && channelRide.current?.live === session.live;
		({ ride, freeRide, ownRide } =
			address.avToken && sessionHolds
				? channelRide.current!
				: channelRide.hold(rideDeps));
		// The lounge is where you last rode (#3274): noted on this device when
		// the roster first says you are riding here — a free ride or a session.
		let notedRiding = false;
		$effect(() => {
			const riding = !!live.tick?.roster.find(
				(r) => r.id === account.me?.id && r.riding,
			);
			if (riding && !notedRiding && address.channel)
				rememberRodeIn(address.crew, address.channel);
			notedRiding = riding;
		});
		// A free ride on a road says which road (#3117): channel-mates on the
		// same one draw each other. The key is read off the road once a road;
		// the way along it is said again at every lap that turns.
		const freeRoad = $derived(
			freeRide.armed && !joined() ? freeRide.road?.profile : undefined,
		);
		const freeWay = $derived(!!freeRide.road?.reverse);
		$effect(() => {
			const road = freeRoad;
			const reverse = freeWay;
			let gone = false;
			if (road)
				void roadHash(road).then(
					(key) => gone || live.rideRoad({ key, ...(reverse && { reverse }) }),
				);
			else live.rideRoad({ key: '' });
			return () => {
				gone = true;
			};
		});

		// One sensor, one screen (#610). The claim belongs to the CONNECTION
		// for the same reason the trainer does: it has to survive the channel's
		// shell unmounting on the way to another page, or a walk to /workouts
		// would hand the rider's own trainer back to their phone.
		$effect(() => {
			// Your own workout borrows the trainer and keeps the claim (#2329).
			live.claimSensors(
				sensorClaim(holds() && (ride.trainer !== null || ownRide.riding)),
			);
		});

		// Away is per rider in the hub (#706), so every one of that rider's
		// screens follows the roster truth. The tab that pressed the button
		// updates itself immediately in ChannelShell; this is what also mutes the
		// desktop when the phone pressed it, and restores each tab to what that
		// tab had live before.
		//
		// It must not apply an echo of the state we just left (#1128). Our own
		// press is optimistic — local first, message second — and the tick
		// already in flight still carries the OLD value. Applying it ran the
		// come-back branch a fifth of a second after the rider pressed Away:
		// the mix unmuted and the mic re-opened itself, so the button read as
		// doing nothing while the call went on hearing them.
		//
		// So a press records what it is waiting for, and the roster is ignored
		// until it agrees — bounded, so a message the server never answers
		// cannot pin this rider's away state to a wish forever. `away-echo.ts`
		// holds the rule and its tests; this is the two lines that call it.
		// A reconnect re-declares away on open (live.svelte.ts), but the hub
		// dropped it with the last socket and a tick in between says
		// away:false — with nothing pressed, the echo was unarmed and that
		// tick re-opened the camera of a rider not at the bike (#1740). Arm
		// it as a press, so the first ticks that disagree are waited out.
		let wasLive = live.status === 'live';
		$effect(() => {
			const nowLive = live.status === 'live';
			if (nowLive && !wasLive && av.away) awayEcho = pressed(true);
			wasLive = nowLive;
		});
		$effect(() => {
			const mine = live.tick?.roster.find(
				(rider) => rider.id === account.me?.id,
			);
			if (!mine) return;
			const server = !!mine.away;
			const step = applyAway(server, awayEcho);
			awayEcho = step.echo;
			if (!step.apply) return;
			void av.setAway(server);
		});

		// Another of the rider's screens took the voice (ADR-0089): this one
		// leaves the call, so nothing doubles and nothing echoes, and stays a
		// controller until it takes the voice back. A join in flight is the
		// seat's to answer, so only a call already up stands down.
		$effect(() => {
			const elsewhere = live.pairing.elsewhere?.voice;
			if (!elsewhere) return;
			if (av.status === 'live' || av.status === 'reconnecting')
				untrack(() => av.leave());
		});

		// Everything the connection says out loud (connection-cues.svelte.ts).
		connectionCues({ address, live, av });
		// A bottle from the roadside waits for this rider's valley (#3022).
		bottleHandUps({
			address,
			live,
			effort: () => effortOf(ride.effort, live.tick?.game, account.me?.id),
		});
		followMoves({ address, live, av });

		// PTT keys work on EVERY page while in voice — and a keyup lost to
		// navigation or focus loss must never leave the mic hot (audit #219).
		$effect(() => {
			if (typeof window === 'undefined') return;
			const key = (event: KeyboardEvent, held: boolean) => {
				if (av.mode !== 'ptt' || event.code !== 'Space') return;
				// A text field, or a control the keyboard is on, keeps its
				// Space (ptt-keys.ts, audit 2026-09-09).
				if (spaceBelongsTo(event.target)) return;
				event.preventDefault();
				if (!held || !event.repeat) av.setPtt(held);
			};
			const down = (e: KeyboardEvent) => key(e, true);
			const up = (e: KeyboardEvent) => key(e, false);
			const release = () => av.pttHeld && av.setPtt(false);
			window.addEventListener('keydown', down);
			window.addEventListener('keyup', up);
			window.addEventListener('blur', release);
			document.addEventListener('visibilitychange', release);
			return () => {
				release();
				window.removeEventListener('keydown', down);
				window.removeEventListener('keyup', up);
				window.removeEventListener('blur', release);
				document.removeEventListener('visibilitychange', release);
			};
		});

		// Easier / Harder from the keys and any clicker, on every page while
		// this channel's ride shifts (#3329) — a clicker cannot see the page.
		shift = createRideShift(ride);
		$effect(() => (ride.shifting && holds() ? bindShifters(shift) : undefined));

		// Your own workout shifts on its riding screen's shifter, which this
		// connection cannot reach; the phone's taps get one of their own (#3333).
		const ownShift = createRideShift({
			easierHarder: (dir) =>
				ownRide.session?.easierHarder(dir) ?? {
					disabled: EASIER_HARDER_OFF.idle,
				},
			atEnd: (dir) => ownRide.session?.atEnd(dir) ?? false,
		});

		// The phone remote's presses, off the tick, through the same inputs as
		// the keys (#3217). The hub sends them to this tab only while it holds
		// the trainer. Easier / Harder is a gear in SIM and the bias in ERG,
		// for the session's ride and your own workout alike (#3333). With the
		// phone's gears off it says Bias, and a tap is what the ride's own −
		// and + move (#4163): a workout's bias, or the free ride's watts or
		// grade.
		const talk = createTalkOpener(av);
		// The phone's Camera, Photo and Cheer (#4253); Cheer answers the last
		// rider to cheer you, so every tick's cheers are heard.
		const remoteWorld = createRemoteWorld({
			me: () => account.me?.id,
			cheer: (emoji, to) => live.cheer(emoji, to),
			deck: () => account.cheers,
		});
		$effect(() => remoteWorld.heard(live.tick?.cheers));
		const remote = createRemoteRunner(
			{
				shifts: () =>
					gearsEnabled('phone') && (ride.shifting || ownRide.riding),
				press: (dir, source) =>
					(ride.shifting ? shift : ownShift).press(dir, source),
				release: (source) => {
					shift.release(source);
					ownShift.release(source);
				},
				trim: (dir) => {
					const step = dir * DEFAULTS.biasStep;
					if (ownRide.riding) ownRide.session?.nudgeBias(step);
					else if (joined()) ride.nudgeBias(step);
					else if (freeRide.armed && !freeRide.road) freeRide.nudge(dir);
				},
			},
			talk,
			{
				// Your own workout's clock is yours: Pause, Resume, Skip block and
				// +1 min (#4425). A session's is the coach's, and has none.
				...clockActions(() => ownRide.session),
				// The riding screen's own controls, from the phone (#4223): its
				// view switch's segments, ⚑, TV and End, where it draws them.
				...offeredActions(),
				...remoteWorld.actions,
			},
		);
		// A controller's Talk is held while its button is, and a lost link
		// lets go (#3335).
		$effect(() =>
			shifterSlot.onAction((action, edge) => {
				if (action === 'talk') talk(edge === 'down');
			}),
		);
		// The holder answers with its gear on a change and after each press, so
		// a phone that joined late still learns where it is (#3217). In ERG
		// the answer is the bias or the watts a tap moved, for your own
		// workout too; a shift tap with no ride running is answered idle,
		// which the hub says as remote_conflict (#3334).
		const tapAnswer = () => {
			if (ride.shifting)
				return shiftAnswer(
					ride,
					joined()
						? { bias: ride.bias }
						: freeRide.mode === 'watts' && !freeRide.road
							? { watts: freeRide.watts }
							: null,
				);
			const solo = ownRide.riding ? ownRide.session : null;
			return solo ? shiftAnswer(solo, { bias: solo.bias }) : null;
		};
		const sayGear = (tapped = false) => {
			const answer = tapAnswer();
			if (answer) live.sendGear(answer);
			else if (
				tapped &&
				gearsEnabled('phone') &&
				!ride.shifting &&
				!ownRide.riding
			)
				live.sendGear({ label: '', atEnd: false, idle: true });
		};
		$effect(() => sayGear());
		// Pause, Skip and +1 min are your own workout's alone: a session is
		// never paused or skipped by one rider (#3217, #4425), so the phone is
		// told there is nothing to press.
		const sayPause = () => live.sendPause(pauseOf(ownRide.session));
		$effect(sayPause);
		// Where this screen looks and what its bar offers, so the phone's view
		// row, Camera, Photo, Flag and TV say what they did (#4223, #4253).
		const sayView = () => live.sendView(viewNow());
		$effect(sayView);
		$effect(() => {
			const off = live.onRemote((cmd) => {
				remote.run(cmd);
				if (cmd.action !== 'talk-keepalive') {
					sayGear(cmd.action === 'easier' || cmd.action === 'harder');
					sayPause();
				}
				// A view, TV or flag press is answered by sayView's effect once
				// the screen has turned; said now it would be the old view, and
				// the hub's 100 ms gap would drop the new one.
				if (cmd.action === 'sync') sayView();
			});
			return () => {
				off();
				remote.stop();
			};
		});

		// LiveKit dropping us while live rejoins with a fresh token — covers
		// token expiry and transient drops (#219) — and keeps trying through
		// an outage, at once when the network returns (#4343). It is a resume,
		// not a fresh join: the mic comes back the way it was, and a rider who
		// muted for a phone call stays muted (#641).
		const recovery = createVoiceRecovery({
			join: () => av.join({ mic: av.micBeforeDrop }),
			status: () => av.status,
			signedOut: () => av.error?.signIn === true,
			stillHere: () => channelConnection.call?.address.key === address.key,
		});
		const onOnline = () => recovery.online();
		let seenDrops = 0;
		let seenLeaves = 0;
		$effect(() => {
			const drops = av.dropped;
			if (drops > seenDrops) {
				seenDrops = drops;
				recovery.dropped();
			}
		});
		$effect(() => {
			const leaves = av.left;
			if (leaves > seenLeaves) {
				seenLeaves = leaves;
				recovery.left();
			}
		});
		$effect(() => {
			window.addEventListener('online', onOnline);
			return () => {
				recovery.stop();
				window.removeEventListener('online', onOnline);
			};
		});
	});
	return {
		address,
		live,
		av,
		/**
		 * You stepped out, or came back (#706). Local AV moves at once; the hub
		 * message makes the same state reach this rider's other screens and
		 * everyone watching. One home for the pair (#807) — the button that
		 * sends it now lives in the sidebar, which has no channel context.
		 */
		setAway(next: boolean, reason = '') {
			// What we are waiting for the server to echo (#1128), so the tick
			// already in flight cannot undo the press that produced it. The
			// echo tracks away-ness alone: the reason changes no mic and no
			// camera, so AV never hears about it.
			awayEcho = pressed(next);
			void av.setAway(next);
			live.setAway(next, reason);
		},
		profile,
		recording,
		ride,
		freeRide,
		ownRide,
		joined,
		riding: () =>
			(isLivePhase(live.tick?.state.phase) && joined()) ||
			freeRide.recording ||
			ownRide.riding,
		shifting: () => ride.shifting || (gearsEnabled() && ownRide.riding),
		shift,
		shared: sharedOf,
		segments: segmentsOf,
		workout: workoutOf,
		rideDeps,
		dispose,
	};
}

export const channelConnection = {
	/** The place the ride is: the crew session you ride, else your call. */
	get current() {
		return session ?? current;
	},
	/** The voice channel you are in: the call, the deck and away. */
	get call() {
		return current;
	},
	/** The crew session you ride, beside the call or without one. */
	get session() {
		return session;
	},
	/**
	 * The connection of `address`'s own place — the crew session or the
	 * call — or null when this tab is not in it. What a place draws of its
	 * session reads this, not `current`: on the call's page beside a session,
	 * `current` is the session, and the call's lounge drew the session's
	 * start line with a Start the ride sent to the call (#4504).
	 */
	at(address: Pick<PlaceAddress, 'key'>) {
		return (
			[session, current].find((c) => c?.address.key === address.key) ?? null
		);
	},
	/**
	 * Whether `pathname` is one of the live place's own pages — its Lounge,
	 * its Training, the session running in it (`onPlacePath`, #2460).
	 */
	onPlacePath(pathname: string): boolean {
		return [session, current].some(
			(c) => !!c && onPlacePath(pathname, c.address, c.live.tick?.state.id),
		);
	},
	/**
	 * A ride is held — a free ride, or the session you joined — and nothing on
	 * screen draws its status: off its place (#2885), or on it with the page
	 * failed to load and no shell mounted (#2986). The frame draws it then; a
	 * ride-critical error is persistent status wherever the rider is.
	 */
	rideStatusUnshown(): boolean {
		const place = session ?? current;
		return (
			!!place &&
			(place.freeRide.recording || place.ownRide.riding || place.joined()) &&
			statusShown === 0
		);
	},
	/** A page's ChannelStatus mounted; the function it returns unmounts it. */
	showingStatus(): () => void {
		statusShown++;
		return () => {
			statusShown--;
		};
	},
	/** Idempotent per place; switching places leaves the old one first. */
	join(address: PlaceAddress) {
		// A crew session has no call: it takes the session's slot and leaves
		// the call where it is (docs/SESSIONS.md).
		// Opening another place moves the device's ride there, still running
		// (#4259): it is never ended by the way in.
		if (!address.avToken) {
			if (session?.address.key === address.key) return session;
			this.leaveSession(true);
			session = connect(address);
			return session;
		}
		if (current?.address.key === address.key) return current;
		this.leaveCall('rider', true);
		current = connect(address);
		return current;
	},
	/**
	 * The now bar's Leave: the crew session first, with the call kept; the
	 * call when there is no session. Signed out leaves both.
	 */
	leave(reason: 'rider' | 'signedOut' = 'rider') {
		if (session) {
			this.leaveSession();
			if (reason === 'rider') return;
		}
		this.leaveCall(reason);
	},
	/**
	 * Leaving a crew session hands the device's ride back to the call, still
	 * running: the trainer stays connected and the ride goes on as your own
	 * (docs/SESSIONS.md). With no call it ends, saved, unless `moving` says
	 * the next place is about to take it.
	 */
	leaveSession(moving = false) {
		if (!session) return;
		const held = channelRide.current?.live === session.live;
		if (held && current) channelRide.hold(current.rideDeps);
		else if (held && !moving) channelRide.leave();
		session.dispose();
		session.live.close();
		session.av.leave();
		session = null;
	},
	/**
	 * Ends the ride, closes the socket, hangs up voice. `'rider'` is the
	 * explicit act — they just pressed Leave, so it goes quietly. Anything
	 * else happened TO them, and a rider three metres from the screen learns
	 * about it by ear or not at all (ux.md): #850 is what one silent drop
	 * cost, a session that expired mid-click taking the channel with it and
	 * nobody noticing. There is no dashboard left to hold a persistent
	 * status, so the toast carries the way back in.
	 */
	leaveCall(reason: 'rider' | 'signedOut' = 'rider', moving = false) {
		if (!current) return;
		const { address } = current;
		const name = address.name;
		// A free ride nobody ended is saved on the way out of the last place
		// that holds it. Its answer arrives after the page has gone. Switching
		// voice channels is not that: `moving` keeps the ride for the next
		// call (#4259). A crew session's ride is not the call's to end.
		if (channelRide.current?.live === current.live && !moving)
			channelRide.leave();
		current.dispose();
		current.live.close();
		current.av.leave();
		// Being out of the music is for this channel, this sitting (#1898): the
		// next channel's dock must not open on "everyone else is listening" with
		// the player unloaded.
		listening.rejoin();
		current = null;
		if (reason === 'rider') return;
		// The leave cue, not the fault buzz: the sound already means "someone
		// is out of the channel", and an error-toned toast would sound its own.
		play('leave');
		// Signed out is the one reason there is (#2634): "your session ended"
		// read as the ride's session, which a rider in the lounge had none of.
		toasts.push(`You were signed out — you left ${name}.`, {
			href: address.home,
			seconds: 12,
		});
	},
};
