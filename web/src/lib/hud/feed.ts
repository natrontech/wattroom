/**
 * The HUD feed (#296, ADR-0041). The riding screen publishes the rider's own
 * numbers once a second on a BroadcastChannel, and /hud — the desktop
 * shell's floating overlay, or simply another tab — subscribes. Same origin,
 * no server, and no claim on the sensor (ADR-0025): the HUD mirrors the
 * screen that holds the trainer, it never reads the trainer itself.
 */
export interface HudSnapshot {
	/** Unix millis when published; a HUD that has not heard for a while says so. */
	at: number;
	watts: number;
	target: number;
	/** Seconds left in the session. */
	remaining: number;
	/** The workout, or the room and its workout. */
	label: string;
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

export function publishHud(snapshot: Omit<HudSnapshot, 'at'>): void {
	open()?.postMessage({ ...snapshot, at: Date.now() } satisfies HudSnapshot);
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

function isSnapshot(x: unknown): x is HudSnapshot {
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
