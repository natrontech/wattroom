import { account } from '$lib/account.svelte';
import { ridePath, type PlaceAddress } from '$lib/channel/address';
import type { createChannelAv } from '$lib/channel/av.svelte';
import { comingsAndGoings } from '$lib/channel/comings-and-goings';
import { dmArrivalEvent } from '$lib/channel/dm-line';
import type { createRoomLive } from '$lib/channel/live.svelte';
import { announcePoke } from '$lib/channel/poke';
import {
	screenShareChanges,
	screenShareEvent,
} from '$lib/channel/screen-shares';
import { divertDmsWhileRiding } from '$lib/messages/announce';
import { shouldAnnounce } from '$lib/notify-once';
import { notify } from '$lib/notify.svelte';
import { play } from '$lib/sound/cues';
import { setDucking } from '$lib/sound/duck';
import { shouldDuck } from '$lib/sound/ducking';
import { mixer } from '$lib/sound/mixer.svelte';
import { untrack } from 'svelte';

/**
 * What the live connection says out loud, wherever in the app you are
 * standing: who arrived, stepped out or joined the call, a screen going up,
 * a poke, a DM mid-ride, a session starting — and the mix ducking under a
 * voice. Called inside the connection's effect root, so every effect here
 * ends when the connection does.
 */
export function connectionCues({
	address,
	live,
	av,
}: {
	address: PlaceAddress;
	live: ReturnType<typeof createRoomLive>;
	av: ReturnType<typeof createChannelAv>;
}): void {
	// Presence announces itself (#148) from HERE, not the page — someone
	// arriving is audible even while you are off browsing workouts; hidden
	// tabs get the browser notification instead (#202).
	let known: Set<string> | null = null;
	let lastPhase: string | null = null;

	$effect(() => {
		const roster = live.tick?.roster ?? [];
		const ids = new Set(roster.map((rider) => rider.id));
		// Coming back announces the whole outage in one burst otherwise
		// (#1741) — the away and voice effects below already forget.
		if (live.status !== 'live') {
			known = null;
			return;
		}
		if (known === null) {
			known = ids;
			return;
		}
		const before = known;
		known = ids;
		const arrived = roster.filter((rider) => !before.has(rider.id));
		const at = live.tick?.at ?? Date.now();
		if (arrived.length > 0) {
			// Once per tag across tabs, and the room's name, not its slug.
			if (!shouldAnnounce(`join-${address.key}-${at}`, at)) return;
			play('join');
			notify.push(
				address.name,
				`${arrived.map((rider) => rider.name).join(', ')} joined the room`,
				`join-${address.key}`,
				{ href: address.home },
			);
		} else if ([...before].some((id) => !ids.has(id))) {
			play('leave');
		}
	});

	// Stepping out is a door too (#906). An away rider stays in the
	// roster, so the pair above never fires and a room of six can empty to
	// one in silence — the mark on their tile is on a screen nobody on a
	// bike is reading (ux.md). The same two cues a fifth down: the same
	// event, one layer in, and less final than actually leaving.
	//
	// Your own press is deliberately not special-cased: it arrives here
	// after `av.setAway` has already muted this device (#875), so going
	// away is silent — you pressed the button — and coming back is the
	// first thing you hear, which is the proof the room's sound is back.
	let knownAway: Map<string, boolean> | null = null;
	$effect(() => {
		const roster = live.tick?.roster;
		// A drop stops the ticks, so the roster on the other side is a
		// fresh observation, not a change — without this, reconnecting
		// announces the whole outage in one burst.
		if (live.status !== 'live' || !roster) {
			knownAway = null;
			return;
		}
		const before = knownAway;
		knownAway = new Map(roster.map((rider) => [rider.id, !!rider.away]));
		if (before === null) return;
		for (const rider of roster) {
			const was = before.get(rider.id);
			// A rider the last tick did not have is arriving, not coming
			// back: that is the cue above's event, not this one's.
			if (was === undefined || was === !!rider.away) continue;
			play(rider.away ? 'leave' : 'join', -7);
		}
	});

	// The voice channel says who arrived (#854). LiveKit chimes for
	// nobody, so a rider joined the call and you found out when they
	// spoke — or you did not. The room's own join/leave cannot stand in:
	// entering the room and entering the call are often hours apart.
	//
	// `tick.voice` and not `av.voice`: a client learns the roster from
	// LiveKit only once it has joined itself, so the local view of an
	// empty call is indistinguishable from a full one you have not
	// entered yet (protocol.go). The server's webhook answer is the only
	// one true for a rider who has not pressed Join.
	//
	// Pitched up a fifth: the same event as arriving in the room, one
	// layer in, and siblings should sound like siblings.
	let knownVoice: Set<string> | null = null;
	$effect(() => {
		const voice = live.tick?.voice;
		// A dropped room stops the ticks, so the roster on the other side
		// of a reconnect is a fresh observation, not a change — without
		// this, coming back announces the whole outage in one burst.
		if (live.status !== 'live' || !voice) {
			knownVoice = null;
			return;
		}
		const now = new Set(voice);
		const before = knownVoice;
		knownVoice = now;
		if (before === null) return;
		for (const change of comingsAndGoings(before, now, account.me?.id))
			play(change.live ? 'join' : 'leave', 7);
	});

	// Someone else's screen appearing announces itself (#664): while the
	// jukebox plays the stage stays on the music, so the share was one chip
	// in a picker nobody on a bike is watching. A local timeline line and
	// the join cue — something arrived in the room — through the mixer like
	// every other cue. Only while voice is live: a drop empties the list,
	// and every share would otherwise read as ended.
	let knownScreens = new Set<string>();
	$effect(() => {
		if (av.status !== 'live') return;
		const now = new Set(
			av.stageSources
				.filter((source) => source.kind === 'screen')
				.map((source) => source.id),
		);
		const changes = screenShareChanges(knownScreens, now, account.me?.id);
		knownScreens = now;
		if (changes.length === 0) return;
		// Untracked: the roster is a new object every tick, and this must
		// run when the shares change, not once a second.
		const tick = untrack(() => live.tick);
		for (const change of changes) {
			const name = tick?.roster.find(
				(rider) => rider.id === change.rider,
			)?.name;
			live.pushEvent(screenShareEvent(change, name, tick?.at ?? Date.now()));
			if (change.live) play('join');
		}
	});

	// A DM arriving while this rider is mid-ride (#1743). The toast it
	// replaces was the only thing on the Training screen that moved and
	// was not data; the line lands in the room's timeline instead, where
	// "what did I miss" is already answered — local-only and never sent
	// (ADR-0022), so a private message reaches nobody else in the room.
	//
	// Running or paused, not merely countdown: the count-in is a rider
	// still walking back to the bike, and auto-pause is a rider reaching
	// for a bottle mid-interval, not a rider who has finished.
	$effect(() =>
		divertDmsWhileRiding((arrival) => {
			// Read outside the announcing caller's reactivity: the tick is a
			// new object every second, and this must not become a dependency
			// of whatever effect happened to be running when a DM landed.
			const phase = untrack(() => live.tick?.state.phase);
			if (phase !== 'running' && phase !== 'paused') return false;
			live.pushEvent(dmArrivalEvent(arrival.title, arrival.at));
			return true;
		}),
	);

	// A poke is delivered to every socket of this rider. localStorage picks
	// one tab on each device to make the sound/notification, while each
	// device still receives it independently. play() keeps the receiver's
	// cue fader authoritative; notify.push() keeps their permission and the
	// hidden-tab gate authoritative.
	$effect(() => {
		const poke = live.lastPoke;
		announcePoke(poke, address.key, address.name, address.home);
	});

	// Room audio follows the connection, not the page (#216): the gate
	// threshold doubles while the jukebox plays, and cues duck under a
	// voice — wherever in the app you are standing.
	$effect(() => {
		av.setDeckPlaying(!!live.tick?.jukebox?.playing);
	});
	// The one caller (#988): the duck follows the CONNECTION, not whichever
	// page is mounted, and both the cue bus and the jukebox subscribe to
	// what it decides. Nothing here holds a timer — the hold and the
	// release live in the controller, where an effect re-running cannot
	// cancel them.
	$effect(() => {
		setDucking(shouldDuck(av.speaking, account.me?.id, mixer.duckSelf));
		// Leaving mid-sentence must not park the mix ducked forever.
		return () => setDucking(false);
	});

	// A session starting is the one event nobody wants to miss (#202).
	$effect(() => {
		const phase = live.tick?.state.phase ?? null;
		const before = lastPhase;
		lastPhase = phase;
		if (
			before !== null &&
			before !== phase &&
			(phase === 'countdown' || phase === 'running') &&
			before !== 'countdown' &&
			before !== 'paused'
		) {
			const at = live.tick?.at ?? Date.now();
			if (shouldAnnounce(`session-${address.key}-${at}`, at))
				notify.push(
					address.name,
					'The session is starting — saddle up',
					`session-${address.key}`,
					{ href: ridePath(address, live.tick?.state.id) },
				);
		}
	});
}
