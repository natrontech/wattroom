import type { ClaimantSource } from '$lib/room/av-types';
import type { AvConn, AvState } from '$lib/room/av-state.svelte';
import type { Mic } from '$lib/room/av-mic';
import type { Publish } from '$lib/room/av-publish';
import { createClaims } from '$lib/room/av-claim.svelte';
import { serverNow } from '$lib/room/server-clock';

/**
 * One rider, several tabs (#293), wired to this connection (#1698).
 *
 * LiveKit gives each tab its own participant, so nothing evicts anything and
 * what is left is a product question — which tab holds the mic. Newest wins:
 * opening a room moves the mic to the tab you are looking at. The protocol is
 * `av-claim.svelte.ts`, which is deliberately SDK-free; this is the half that
 * reaches the connection, and it is where the SDK stops on the way out.
 *
 * The two mic buttons live here rather than with the mic itself because both
 * have to ask this question before they act: pressing the mic in a tab that
 * stood down means "bring it here", not "publish a second one", and the fault
 * banner must not reconnect a mic that now lives in another tab (#824).
 */
export interface TabsHost {
	av: AvState;
	conn: AvConn;
	mic: Mic;
	publish: Publish;
	/** Who is in voice and whether their mic is open (#151). */
	setVoice(id: string, state: 'live' | 'muted' | null): void;
	/** Restamp the "I was in voice here" note (#480). */
	noteVoice(): void;
}

export type Tabs = ReturnType<typeof createTabs>;

export function createTabs(host: TabsHost) {
	const { av, conn, mic, publish, setVoice, noteVoice } = host;
	const chain = mic.chain;

	/** A participant as the claim protocol sees it — no SDK past this line. */
	function claimantOf(p: ClaimantSource) {
		const pub = p.getTrackPublication(conn.liveKit!.Track.Source.Microphone);
		return {
			identity: p.identity,
			joinedAt: p.joinedAt,
			micOpen: !!pub && !pub.isMuted,
		};
	}

	// A tab joining needs no announcement — LiveKit tells everyone, with a
	// server-assigned joinedAt that beats comparing browser clocks. Only an
	// explicit "use this tab instead" has to be broadcast, and by then the
	// sender is a participant the others already know. (Publishing a claim on
	// join instead looked simpler and did not work: the packet outruns the
	// join event, and the receiver gets it with no sender attached.)
	const claims = createClaims({
		identity: () => conn.myIdentity,
		now: () => serverNow(),
		participants: () =>
			conn.room
				? [
						conn.room.localParticipant,
						...conn.room.remoteParticipants.values(),
					].map(claimantOf)
				: [],
		others: () =>
			conn.room
				? [...conn.room.remoteParticipants.values()].map(claimantOf)
				: [],
		announce: (at) => {
			void conn.room?.localParticipant
				.publishData(
					new TextEncoder().encode(JSON.stringify({ t: 'av-claim', at })),
					{ reliable: true },
				)
				.catch(() => {});
		},
		handedOff: () => av.handedOff,
		setHandedOff: (next) => (av.handedOff = next),
		micOn: () => av.micOn,
		closeMic: () => {
			chain.close();
			av.micOn = false;
		},
		clearFault: () => chain.clearFault(),
		closeCam: () => publish.closeCam(),
		noteVoice: () => noteVoice(),
	});

	/** Live here, or live in another tab of the rider's (#293). */
	function voiceHere() {
		setVoice(
			conn.me,
			av.micOn || claims.micLive(conn.me, conn.myIdentity) ? 'live' : 'muted',
		);
	}

	/** Take the mic and camera back into this tab; the others stand down. */
	async function takeOver({ reopenMic = true } = {}) {
		if (!conn.room) return;
		claims.claim();
		if (reopenMic && !av.micOn) {
			await mic.tryOpen();
			setVoice(conn.me, av.micOn ? 'live' : 'muted');
		}
		noteVoice();
	}

	return {
		claims,
		claimantOf,
		takeOver,
		async toggleMic() {
			if (!conn.room) return;
			if (chain.testing) chain.stopTest();
			// Pressing the mic in a tab that stood down means "bring it here",
			// not "publish a second one" — the rail says the mic lives in
			// another tab, and the button must not quietly contradict it.
			if (av.handedOff) {
				await takeOver();
				return;
			}
			if (av.micOn) {
				chain.close();
				av.micOn = false;
			} else {
				await mic.tryOpen();
			}
			voiceHere();
			noteVoice();
		},
		/**
		 * The fault banner's one big button: open the mic again. A device
		 * still missing leaves the fault standing — the banner is telling the
		 * truth and the button is the way back once the headset is plugged in.
		 */
		async reconnectMic() {
			// The same guards the mic button has (#824): in a tab that stood
			// down the mic lives elsewhere, and away means closed on purpose —
			// reconnecting here would publish a second one.
			if (!conn.room || av.handedOff || av.away) {
				chain.clearFault();
				return;
			}
			await mic.tryOpen();
			voiceHere();
			noteVoice();
		},
	};
}
