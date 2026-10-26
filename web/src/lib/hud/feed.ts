/**
 * The HUD feed (#296, ADR-0041). The riding screen publishes the rider's own
 * numbers once a second on a BroadcastChannel, and /hud — the desktop
 * shell's floating overlay, or simply another tab — subscribes. Same origin,
 * no server, and no claim on the sensor (ADR-0025): the HUD mirrors the
 * screen that holds the trainer, it never reads the trainer itself.
 */
import { account } from '$lib/account.svelte';
import { hrZoneOf, zoneOf } from '$lib/components/zones';
import type { RoadReadout } from '$lib/road/readout';
import type { Block } from '$lib/workout/block';

/** The block a structured ride is in (#4212): its time left, NEXT and the rep. */
export type HudBlock = Pick<Block, 'secondsLeft' | 'next' | 'rep'>;

export interface HudSnapshot {
	/** Unix millis when published; a HUD that has not heard for a while says so. */
	at: number;
	watts: number;
	target: number;
	/** Seconds left in the session. */
	remaining: number;
	/**
	 * Seconds ridden, for a ride with no end to count down to — a free ride
	 * (#2843). Set, the HUD shows it in place of `remaining`.
	 */
	elapsed?: number;
	/** The workout's name, solo or in a session. */
	label: string;
	/** rpm. Absent from a HUD older than it, and drawn only when sent. */
	cadence?: number;
	/** bpm, only with a heart-rate source. */
	heartRate?: number;
	/** The heart rate's zone, 1–5, when the account holds an LTHR. */
	heartZone?: number;
	/**
	 * The power zone, 1–7, from the account's FTP; 0 while the rider
	 * coasts. Absent from a feed older than it, and the strip is not drawn.
	 */
	zone?: number;
	/** Seconds in `zone` since entering it, counted only while pedalling. */
	zoneSeconds?: number;
	/**
	 * What the riding screen would be shouting about (#1665): the trainer's
	 * signal is gone, or the voice channel's socket is. A HUD that shows a
	 * confident 0 for a dropped trainer is worse than none (errors.md).
	 */
	fault?: 'trainer' | 'channel';
	/**
	 * Where a ride on a road is (#3060): the one readout slot 1 and every HUD
	 * say it from. Absent off a road, and ignored by a HUD older than it.
	 */
	road?: RoadReadout;
	/**
	 * The block, on a ride of structured blocks (#4212). Absent on a free
	 * ride, a one-block ride and a route ride, and ignored by a HUD older
	 * than it.
	 */
	block?: HudBlock;
}

const CHANNEL = 'wattroom.hud';
/** Two missed ticks: the ride ended, or its tab is gone. */
export const HUD_STALE_MS = 5_000;

let channel: BroadcastChannel | null = null;
function open(): BroadcastChannel | null {
	if (channel) return channel;
	try {
		channel = new BroadcastChannel(CHANNEL);
	} catch {
		channel = null; // no BroadcastChannel: the HUD simply never hears
	}
	return channel;
}

type Derived = 'at' | 'zone' | 'zoneSeconds' | 'heartZone';

/**
 * How long the rider has held their zone (#4099). From timestamps, not from
 * calls: a channel publishes on every change it hears, not once a second.
 * Watts at 0 is no zone, as live-stats counts none; a gap longer than the
 * stale window is a new ride.
 */
export function createZoneClock() {
	let zone = 0;
	let since = 0;
	let last = -Infinity;
	return (next: number, at: number): number | undefined => {
		if (next !== zone || at - last > HUD_STALE_MS) {
			zone = next;
			since = at;
		}
		last = at;
		return zone > 0 ? Math.floor((at - since) / 1000) : undefined;
	};
}

const zoneClock = createZoneClock();

/** The zones the account's FTP and LTHR put the snapshot in. */
export function withZones(
	snapshot: Omit<HudSnapshot, Derived>,
	at: number,
	rider: { ftpWatts: number; lthr?: number } | null,
	clock = zoneClock,
): HudSnapshot {
	const out: HudSnapshot = { ...snapshot, at };
	if (!rider) return out;
	const heartZone = hrZoneOf(snapshot.heartRate ?? 0, rider.lthr);
	if (heartZone) out.heartZone = heartZone;
	if (rider.ftpWatts > 0) {
		out.zone = snapshot.watts > 0 ? zoneOf(snapshot.watts, rider.ftpWatts) : 0;
		const seconds = clock(out.zone, at);
		if (seconds !== undefined) out.zoneSeconds = seconds;
	}
	return out;
}

export function publishHud(snapshot: Omit<HudSnapshot, Derived>): void {
	open()?.postMessage(withZones(snapshot, Date.now(), account.me));
}

/** Hears every snapshot until the returned function is called. */
export function subscribeHud(onSnapshot: (s: HudSnapshot) => void): () => void {
	const c = open();
	if (!c) return () => {};
	const handler = (e: MessageEvent<HudSnapshot>) => {
		if (isSnapshot(e.data)) onSnapshot(e.data);
	};
	c.addEventListener('message', handler);
	return () => c.removeEventListener('message', handler);
}

export function isStale(s: HudSnapshot | null, now = Date.now()): boolean {
	return !s || now - s.at > HUD_STALE_MS;
}

/**
 * What a HUD accepts: the fields every snapshot has always carried, and
 * nothing it does not know refused — a HUD window left open across an
 * upgrade keeps reading the newer feed (#3060).
 */
export function isSnapshot(x: unknown): x is HudSnapshot {
	const s = x as Partial<HudSnapshot> | null;
	return (
		!!s &&
		typeof s.at === 'number' &&
		typeof s.watts === 'number' &&
		typeof s.target === 'number' &&
		typeof s.remaining === 'number' &&
		typeof s.label === 'string'
	);
}
