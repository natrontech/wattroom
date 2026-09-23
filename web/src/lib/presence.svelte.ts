import { api } from '$lib/api';
import { STALE_AFTER } from '$lib/stale';
import type { CrewRef } from '$lib/crew-types';

/**
 * The one shared presence feed (#251), replacing three 10 s pollers: a lobby
 * socket to /ws/presence that the hub pings on ANY presence change — join,
 * leave, voice, camera, phase, riding, a friend coming online. The socket
 * carries no data; a ping means "re-fetch what you show". Holding it is what
 * makes YOU read as online to your friends.
 */
let crews = $state<CrewRef[]>([]);
// The last read's failure. A failed read used to become an empty list, and
// Home told a rider with ten rooms to open their first (audit 2026-09-09);
// now the list you had stays and the page can say what happened.
let error = $state<string | null>(null);
// How many reads in a row have failed. The socket dropping is not the frozen
// case — the fallback poll below and the visibility re-fetch bound that — but
// a read that keeps failing with a list already on screen is unbounded: the
// crews, the dots and "32 min in" keep their last values with full confidence
// for as long as it lasts (#1743).
let failures = $state(0);
let version = $state(0);
let socket: WebSocket | null = null;
let fallback: ReturnType<typeof setInterval> | null = null;
let reconnect: ReturnType<typeof setTimeout> | null = null;
let attempts = 0;
let stopped = true;
// #912: the hub pings EVERY signed-in rider on every chat line, and the ping
// is contentless by design, so each one used to be its own fetch — a fast
// exchange of N messages cost N round trips per rider online anywhere. The
// server's own ping channel only coalesces when a writer falls behind, which
// it normally does not.
const PING_WINDOW_MS = 250;
let pingWindow: ReturnType<typeof setTimeout> | null = null;
let pingedDuringWindow = false;

async function refresh() {
	const res = await api<{ crews: CrewRef[] }>('/api/crews');
	if (res.ok) {
		error = null;
		failures = 0;
		crews = res.data.crews;
	} else {
		error = res.error.message;
		failures += 1;
	}
	version += 1;
	// Arrivals are the crew read's to announce (crew-arrivals.ts, #2457).
}

/**
 * A ping-driven refresh, at most one per window. Leading edge on purpose: the
 * badge for the first message of a conversation must not wait 250 ms, and it
 * is the burst behind it that is worth collapsing. A ping that lands inside
 * the window is not dropped — it refreshes once when the window closes, so
 * the last state of a burst is always fetched.
 */
function refreshCoalesced() {
	if (pingWindow) {
		pingedDuringWindow = true;
		return;
	}
	void refresh();
	pingWindow = setTimeout(() => {
		pingWindow = null;
		if (pingedDuringWindow) {
			pingedDuringWindow = false;
			refreshCoalesced();
		}
	}, PING_WINDOW_MS);
}

function connect() {
	// Never dial while a socket is in flight or open (same rule as the voice
	// channel's WS).
	if (stopped || (socket && socket.readyState <= WebSocket.OPEN)) return;
	const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
	socket = new WebSocket(`${scheme}://${location.host}/ws/presence`);
	// On (re)open, catch up on whatever the gap missed.
	socket.onopen = () => {
		attempts = 0;
		void refresh();
	};
	socket.onmessage = () => refreshCoalesced();
	socket.onclose = () => {
		if (stopped) return;
		attempts += 1;
		// Jittered (#1741): a server restart brought the whole fleet back in
		// lockstep at 2 s, 4 s, 8 s.
		const wait = Math.min(1000 * 2 ** attempts, 10_000) * (0.5 + Math.random());
		reconnect = setTimeout(connect, wait);
	};
}

function onVisible() {
	if (document.visibilityState !== 'visible' || stopped) return;
	void refresh();
	connect();
}

export const presence = {
	/** Every crew you are in (#1476), live. */
	get crews() {
		return crews;
	},
	/** False until the first answer lands — a skeleton, not an empty list. */
	get loaded() {
		return version > 0;
	},
	/** The server's message when the last read failed; null when it answered. */
	get error() {
		return error;
	},
	/**
	 * What is on screen is older than it looks: two reads in a row have
	 * failed, so the crew list, the presence dots and "32 min in" are frozen
	 * at whatever they last were. The sidebar marks its crew header with it —
	 * the populated half of errors.md's four states, which only the empty half
	 * used to have.
	 */
	get stale() {
		return failures >= STALE_AFTER;
	},
	/** Bumps on every change ping — pages re-fetch what they show off this. */
	get version() {
		return version;
	},
	/** Re-fetch now — after leaving or joining a crew, ahead of the next ping. */
	reload() {
		void refresh();
	},
	/** Idempotent; the layout starts it once signed-in and framed. */
	start() {
		if (!stopped) return;
		stopped = false;
		void refresh();
		connect();
		// A tab that wakes from sleep has a socket the browser may not report
		// dead for a while and dots drawn with full confidence (#1741): on
		// becoming visible, re-fetch and re-dial — a live socket makes the
		// dial a no-op.
		document.addEventListener('visibilitychange', onVisible);
		// ponytail: 60 s fallback poll behind the push — covers a dead socket
		// and keeps "32 min in" from freezing when nothing else changes.
		fallback = setInterval(() => void refresh(), 60_000);
	},
	stop() {
		stopped = true;
		document.removeEventListener('visibilitychange', onVisible);
		if (fallback) clearInterval(fallback);
		if (reconnect) clearTimeout(reconnect);
		failures = 0;
		if (pingWindow) clearTimeout(pingWindow);
		pingWindow = null;
		pingedDuringWindow = false;
		socket?.close();
		socket = null;
		crews = [];
		error = null;
	},
};
