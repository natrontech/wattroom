/**
 * Which tab holds the mic and camera (#293, #892).
 *
 * LiveKit gives each tab its own participant, so nothing evicts anything and
 * what is left is a product question: newest claim wins, so opening a room
 * moves the mic to the tab you are looking at.
 *
 * Split out of `av.svelte.ts`, which was one closure wide enough that a
 * cross-wired bug looked local. The pure half already lived in `tabs.ts`
 * (`riderOf`, `yieldsTo`, `micLiveElsewhere`); this is the stateful wrapper,
 * and it reaches the connection through a host so nothing here imports the
 * SDK — which is what lets the protocol be tested without a LiveKit mock.
 *
 * Three bugs are encoded in here and worth not re-learning:
 *
 * - A tab joining needs no announcement — LiveKit tells everyone, with a
 *   server-assigned `joinedAt` that beats comparing browser clocks. Only an
 *   explicit "use this tab instead" is broadcast, and by then the sender is a
 *   participant the others already know. Publishing a claim on join instead
 *   looked simpler and did not work: the packet outruns the join event, and
 *   the receiver gets it with no sender attached.
 * - The takeover is stamped on the SERVER's clock, because the join stamps it
 *   competes with are LiveKit's (#646). A browser clock behind the server made
 *   the takeover read older than the incumbent's join, so it never stood down;
 *   one ahead made a tab opened right after read older than the takeover. Both
 *   ways, doubled audio.
 * - A claim that never lands leaves both tabs publishing: doubled audio, which
 *   the rider can hear and fix. Better than a silent stand-down on a channel
 *   that failed, so the publish swallows its error.
 */
import {
	type Claim,
	micLiveElsewhere,
	riderOf,
	yieldsTo,
} from '$lib/room/tabs';

/** One participant, as much of it as the protocol needs. */
export interface ClaimParticipant {
	identity: string;
	joinedAt?: Date;
	/** Open mic on this connection — the host answers, so the SDK stays out. */
	micOpen?: boolean;
}

export interface ClaimHost {
	/** This connection's identity; empty outside a call. */
	identity(): string;
	/** Server millis — never the browser's clock (#646). */
	now(): number;
	/** Everyone in the room right now, this connection included. */
	participants(): ClaimParticipant[];
	/** Everyone EXCEPT this connection. */
	others(): ClaimParticipant[];
	/** Broadcast "the mic is moving here, now". Failure is swallowed upstream. */
	announce(at: number): void;
	/** True while this tab has handed the mic to another of the rider's tabs. */
	handedOff(): boolean;
	setHandedOff(next: boolean): void;
	/** The mic, as this tab holds it. */
	micOn(): boolean;
	closeMic(): void;
	/** The mic path has no fault to report once the mic lives elsewhere. */
	clearFault(): void;
	closeCam(): Promise<void>;
	/** Re-stamp the "I was in voice here" note, so it stops vetoing a rejoin. */
	noteVoice(): void;
}

export type Claims = ReturnType<typeof createClaims>;

export function createClaims(host: ClaimHost) {
	let mine: Claim | null = null;
	/** Whether the mic was open when this tab handed over, for taking it back. */
	let micBeforeHandoff = false;

	function claimOf(p: ClaimParticipant): Claim {
		return { identity: p.identity, at: p.joinedAt?.getTime() ?? Date.now() };
	}

	/** Stand down if this participant is a newer tab of mine. */
	function consider(p: ClaimParticipant): void {
		if (mine && yieldsTo(mine, claimOf(p))) void standDown();
	}

	/** Announce that the mic and camera are moving here, now. */
	function claim(): void {
		const at = host.now();
		mine = { identity: host.identity(), at };
		host.setHandedOff(false);
		host.announce(at);
	}

	/**
	 * Is any OTHER connection of this rider publishing an open mic?
	 *
	 * Muting here is unpublishing, and the room keys mic state by rider while
	 * the events that drive it are per connection — so a tab standing down
	 * broadcasts an unpublish for a rider who is still live in the tab that
	 * just took over, and everyone reads them as muted. Ask the room instead
	 * of trusting the event.
	 */
	function micLive(rider: string, except: string): boolean {
		return micLiveElsewhere(
			host.participants().map((p) => ({
				identity: p.identity,
				micOpen: !!p.micOpen,
			})),
			rider,
			except,
		);
	}

	/** Is any other connection of this rider still in the room? */
	function stillHere(rider: string, except: string): boolean {
		return host
			.others()
			.some((p) => p.identity !== except && riderOf(p.identity) === rider);
	}

	/** The mic and camera move to whichever tab of the rider's is newer. */
	async function standDown(): Promise<void> {
		if (host.handedOff()) return;
		host.setHandedOff(true);
		// The mic lives in the other tab now: no fault to reconnect from here.
		host.clearFault();
		micBeforeHandoff = host.micOn();
		if (micBeforeHandoff) host.closeMic();
		// The note stops vetoing a rejoin in the tab that now holds the mic.
		host.noteVoice();
		await host.closeCam();
		// Screenshare deliberately stays. Sharing a laptop screen while riding
		// from the tablet is a real thing to want, and unlike a mic two shares
		// do not fight — they are silent.
	}

	return {
		claim,
		consider,
		micLive,
		stillHere,
		standDown,
		/** Whether the mic was open when this tab handed over. */
		get micBeforeHandoff() {
			return micBeforeHandoff;
		},
		/** Only for the rejoin path, which restores the claim it left with. */
		get current() {
			return mine;
		},
		set current(next: Claim | null) {
			mine = next;
		},
	};
}
