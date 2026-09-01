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
let version = $state(0);
let socket: WebSocket | null = null;
let fallback: ReturnType<typeof setInterval> | null = null;
let reconnect: ReturnType<typeof setTimeout> | null = null;
let attempts = 0;
let stopped = true;

async function refresh() {
	rooms = await fetchRailRooms();
	version += 1;
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
	socket.onmessage = () => void refresh();
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
	/** False until the first answer lands — a skeleton, not an empty list. */
	get loaded() {
		return version > 0;
	},
	/** Bumps on every change ping — pages re-fetch what they show off this. */
	get version() {
		return version;
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
		if (fallback) clearInterval(fallback);
		if (reconnect) clearTimeout(reconnect);
		socket?.close();
		socket = null;
		rooms = [];
	},
};
