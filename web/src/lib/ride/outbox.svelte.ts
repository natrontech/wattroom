import { account } from '#lib/account.svelte.ts';
import { createHistoryStore } from '#lib/history.svelte.ts';
import type { RideBatzen } from '#lib/ride/batzen.ts';
import { discardRide, refuseRide, unfinishedRides } from '#lib/ride/buffer.ts';
import { uploadPayload } from '#lib/ride/recovered.ts';
import { toastSaved, uploadRide } from '#lib/ride/save.ts';

/**
 * The rides this device kept because the account did not take them, sent
 * again until it does (#4600). A save fails when the server is down for a
 * deploy, the Wi-Fi drops at End ride, or a sign-in ran out; the ride waits
 * in the crash buffer, and waiting for the rider to find the card on Rides is
 * how a 3 h ride sat unsaved. The endpoint keys a ride on its start, so
 * sending one twice files it once.
 *
 * Runs on sign-in, when the browser is back online or the window back in
 * view, and after a failed save; while something is left it asks again,
 * further apart each time. One tab at a time, under a Web Lock.
 */
const AGAIN_MS = [30_000, 60_000, 120_000, 300_000, 600_000];
/** After a save failed in front of the rider: soon, but not on top of it. */
const AFTER_FAILURE_MS = 15_000;

type Saved = { id: string; xp?: number; batzen?: RideBatzen };
/** Answers true when it showed the save itself, so no toast doubles it. */
type Claim = (rideId: string, saved: Saved) => boolean;

let started = false;
let running = false;
let tries = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const claims = new Set<Claim>();
/** Bumped when a ride left the device, so the card reads the buffer again. */
let sent = $state(0);

function later(ms: number) {
	clearTimeout(timer);
	timer = setTimeout(() => void run(), ms);
}

/** One pass under the lock; another tab holding it is doing this already. */
function exclusively(work: () => Promise<void>): Promise<void> {
	try {
		return navigator.locks
			.request('wattroom-outbox', { ifAvailable: true }, (lock) =>
				lock ? work() : undefined,
			)
			.catch(() => {});
	} catch {
		// No Web Locks: two tabs may both send, and the server files it once.
		return work();
	}
}

async function run(): Promise<void> {
	const owner = account.me?.id;
	if (!owner || running) return;
	running = true;
	let left = false;
	try {
		await exclusively(async () => {
			for (const ride of await unfinishedRides(owner)) {
				// A ride from before rides named their rider is never filed
				// (canSave); the card offers it to download.
				const upload = ride.ownerId === owner && uploadPayload(ride);
				// Refused for good: the card's to download, never sent again.
				if (!upload || ride.refused) continue;
				const outcome = await uploadRide(upload);
				if ('failure' in outcome) {
					if (outcome.failure.final)
						await refuseRide(ride.rideId, outcome.failure.message);
					else {
						// Unreachable, or a 5xx: the rest would fail the same way.
						left = true;
						break;
					}
					continue;
				}
				await discardRide(ride.rideId);
				// A workout alone kept its summary on the device as well (#110).
				createHistoryStore(() => owner).remove(String(ride.startedAt));
				sent++;
				let shown = false;
				for (const claim of claims)
					shown = claim(ride.rideId, outcome.saved) || shown;
				if (!shown) toastSaved(outcome.saved);
			}
		});
	} finally {
		running = false;
	}
	tries = left ? tries + 1 : 0;
	if (left) later(AGAIN_MS[Math.min(tries - 1, AGAIN_MS.length - 1)]);
}

export const outbox = {
	/** Idempotent; the app's layout starts it once someone is signed in. */
	start() {
		if (started) return;
		started = true;
		addEventListener('online', () => void run());
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'visible') void run();
		});
		void run();
	},
	/** A save just failed: try it again shortly. */
	kick() {
		tries = 0;
		later(AFTER_FAILURE_MS);
	},
	/** Now, for a test or a page that knows the server is back. */
	run,
	/**
	 * Hear about a ride the outbox saved: the closing card still showing it
	 * says Saved instead of the failure. The function returned stops it.
	 */
	claim(fn: Claim): () => void {
		claims.add(fn);
		return () => claims.delete(fn);
	},
	/** How many rides it has sent; read it to read the buffer again after one. */
	get sent() {
		return sent;
	},
};
