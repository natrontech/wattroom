import { api } from '$lib/api';
import type { RailRoom } from '$lib/room/mockcompat';

/**
 * The app-wide presence store (#251): ONE rooms list, fed by a lobby socket
 * instead of per-page polling. The server pings when any room's presence
 * changes (join/leave, voice, camera, session phase); the store re-fetches
 * /api/rooms — already membership-filtered, so the push carries no data.
 * The rail, /home and /rooms all read from here.
 */
interface RoomEntry {
	slug: string;
	name: string;
	icon?: string;
	memberCount?: number;
	connected?: number;
	phase?: string;
	riders?: string[];
	voice?: string[];
	video?: string[];
	riding?: string[];
	liveSession?: { workoutName: string; elapsedSec: number };
	nextSession?: { workoutName: string; startsAt: string };
}

let rooms = $state<RailRoom[]>([]);
let loaded = $state(false);
let error = $state<string | null>(null);
let started = false;
let socket: WebSocket | null = null;
let attempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let fallbackTimer: ReturnType<typeof setInterval> | null = null;

async function fetchNow() {
	const res = await api<{ rooms: RoomEntry[] }>('/api/rooms');
	if (!res.ok) {
		error = res.error.message;
		return;
	}
	error = null;
	loaded = true;
	rooms = res.data.rooms.map((room) => ({
		name: room.name,
		icon: room.icon,
		slug: room.slug,
		live: room.phase === 'running' || room.phase === 'countdown',
		members: room.memberCount ?? 0,
		connected: room.connected ?? 0,
		riders: room.riders ?? [],
		voice: room.voice ?? [],
		video: room.video ?? [],
		riding: room.riding ?? [],
		session: room.liveSession && { ...room.liveSession, at: Date.now() },
		next: room.nextSession,
	}));
}

/** Coalesce ping bursts (a join + its voice webhook) into one fetch. */
function refresh() {
	if (!started || refreshTimer) return;
	refreshTimer = setTimeout(() => {
		refreshTimer = null;
		void fetchNow();
	}, 200);
}

function connect() {
	if (!started || (socket && socket.readyState <= WebSocket.OPEN)) return;
	const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
	socket = new WebSocket(`${scheme}://${location.host}/ws/presence`);
	socket.onopen = () => {
		attempts = 0;
	};
	// The server's hello ping doubles as the catch-up fetch after a reconnect.
	socket.onmessage = refresh;
	socket.onclose = () => {
		if (!started) return;
		attempts += 1;
		reconnectTimer = setTimeout(
			connect,
			Math.min(1000 * 2 ** attempts, 30_000),
		);
	};
}

export const railPresence = {
	get rooms() {
		return rooms;
	},
	/** False until the first successful fetch — pages show their skeletons. */
	get loaded() {
		return loaded;
	},
	get error() {
		return error;
	},
	/** Idempotent; the layout starts it once signed in and framed. */
	start() {
		if (started) return;
		started = true;
		void fetchNow();
		connect();
		// ponytail: 60 s safety poll behind the push — covers a missed ping;
		// drop it when the lobby socket has earned trust.
		fallbackTimer = setInterval(() => void fetchNow(), 60_000);
	},
	stop() {
		started = false;
		if (reconnectTimer) clearTimeout(reconnectTimer);
		if (refreshTimer) clearTimeout(refreshTimer);
		if (fallbackTimer) clearInterval(fallbackTimer);
		reconnectTimer = refreshTimer = fallbackTimer = null;
		socket?.close();
		socket = null;
	},
	refresh,
};
