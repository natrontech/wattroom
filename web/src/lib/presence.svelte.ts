import { announce } from '$lib/messages/announce';
import { fetchRailRooms } from '$lib/nav/rooms';
import type { RailRoom } from '$lib/room/mockcompat';

/**
 * The one shared presence feed (#251), replacing three 10 s pollers: a lobby
 * socket to /ws/presence that the hub pings on ANY presence change — join,
 * leave, voice, camera, phase, riding, a friend coming online. The socket
 * carries no data; a ping means "re-fetch what you show". Holding it is what
 * makes YOU read as online to your friends.
 */
let rooms = $state<RailRoom[]>([]);
let maxOwned = $state(0);
let version = $state(0);
let socket: WebSocket | null = null;
let fallback: ReturnType<typeof setInterval> | null = null;
let reconnect: ReturnType<typeof setTimeout> | null = null;
let attempts = 0;
let stopped = true;
// The first answer is the state of the world, not a burst of arrivals.
let announced = false;
// #912: the hub pings EVERY signed-in rider on every chat line, and the ping
// is contentless by design, so each one used to be its own fetch — a fast
// exchange of N messages cost N round trips per rider online anywhere. The
// server's own ping channel only coalesces when a writer falls behind, which
// it normally does not.
const PING_WINDOW_MS = 250;
let pingWindow: ReturnType<typeof setTimeout> | null = null;
let pingedDuringWindow = false;

async function refresh() {
	const list = await fetchRailRooms();
	rooms = list.rooms;
	maxOwned = list.maxOwned;
	version += 1;
	if (!announced) {
		announced = true;
		return;
	}
	// A room you are NOT standing in reaches you the way a DM does (#568).
	// Its unread count is the whole trigger: standing in a room reads it
	// (#468), so a count above zero already means you are somewhere else.
	// The tag is the room's own, shared with the in-room path — whichever
	// path sees a line first announces it, and never both.
	const here = location.pathname;
	for (const room of rooms) {
		const last = room.lastChat;
		if (!last?.at || !room.unread) continue;
		announce({
			tag: `chat-${room.slug}`,
			at: last.at,
			title: `${last.from} · ${room.name}`,
			body: last.text || (last.hasImage ? 'sent an image' : ''),
			href: `/messages/r/${room.slug}`,
			reading: !document.hidden && here === `/messages/r/${room.slug}`,
		});
	}
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
	// Never dial while a socket is in flight or open (same rule as the room WS).
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
		reconnect = setTimeout(connect, Math.min(1000 * 2 ** attempts, 10_000));
	};
}

export const presence = {
	/** The rail's room list, live. */
	get rooms() {
		return rooms;
	},
	/** docs/SPEC.md's owned-room cap, as the server enforces it; 0 until known. */
	get maxOwned() {
		return maxOwned;
	},
	/** False until the first answer lands — a skeleton, not an empty list. */
	get loaded() {
		return version > 0;
	},
	/** Bumps on every change ping — pages re-fetch what they show off this. */
	get version() {
		return version;
	},
	/** Re-fetch now — after leaving or joining a room, ahead of the next ping. */
	reload() {
		void refresh();
	},
	/** Idempotent; the layout starts it once signed-in and framed. */
	start() {
		if (!stopped) return;
		stopped = false;
		void refresh();
		connect();
		// ponytail: 60 s fallback poll behind the push — covers a dead socket
		// and keeps "32 min in" from freezing when nothing else changes.
		fallback = setInterval(() => void refresh(), 60_000);
	},
	stop() {
		stopped = true;
		// Signing out and back in starts the world over — the first list a new
		// session sees must not blip once per room.
		announced = false;
		if (fallback) clearInterval(fallback);
		if (reconnect) clearTimeout(reconnect);
		if (pingWindow) clearTimeout(pingWindow);
		pingWindow = null;
		pingedDuringWindow = false;
		socket?.close();
		socket = null;
		rooms = [];
		maxOwned = 0;
	},
};
