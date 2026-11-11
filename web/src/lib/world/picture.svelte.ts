import { api } from '#lib/api.ts';
import { MaxRidePhotos } from '#lib/protocol.ts';
import { at } from '#lib/road/along.ts';
import { hairpinsOf } from '#lib/road/climbs.ts';
import type { Route } from '#lib/road/route.ts';
import { toasts } from '#lib/toast.svelte.ts';

/** The world's two pictures of one moment (#4431): you, from the picture's own lens, and the ride from above, as its heli camera saw it. Either is null where the browser gave none. */
export type WorldShots = { rider: Blob | null; above: Blob | null };

/** A photo the rider took: its number on the ride, 1 to MaxRidePhotos, and the pair drawn at its moment. */
export type Photo = WorldShots & { n: number };

/** One picture to draw as the world closes: photo `n`, or the ride's best moment where `n` is null. */
export type PictureJob = {
	n: number | null;
	shoot: () => Promise<WorldShots | null>;
};

/** Where the ride's photos stand on their way to its page. */
export type Keeping = {
	/** Photos the ride's page holds. */
	kept: number;
	/** What went wrong with the last one that did not get there, until a retry. */
	error: string | null;
};

/**
 * The ride's pictures of the world (#4221, #4263, #4431): drawn when the
 * world closes, with no name in them. The rider's own photos, taken with
 * Photo, the O key or a controller's snap, go to the saved ride's page once
 * it has an id (`keepWith`), so the rider finds them there after the ride on
 * any device. A ride with no photo of the rider's gets one pair at its best
 * moment, kept in this tab's memory only, for the closing card.
 */
let photos = $state<Photo[]>([]);
let best = $state<WorldShots | null>(null);
let taken = $state(0);
let drawing = $state(0);
let keeping = $state<Keeping>({ kept: 0, error: null });
// Which ride a picture being drawn belongs to: a new ride's world lets a late one go.
let ride = 0;
// The saved ride the photos go to, and the photos already sent or on their way.
let keepId: string | null = null;
let sent = new Set<number>();

const VIEWS = [
	['world', 'rider'],
	['overhead', 'above'],
] as const;

/** One photo to the ride's page, both views; the server's word when it refuses. */
async function upload(rideId: string, photo: Photo): Promise<string | null> {
	for (const [view, key] of VIEWS) {
		const blob = photo[key];
		if (!blob) continue;
		const res = await api<void>(
			`/api/rides/${encodeURIComponent(rideId)}/photos/${photo.n}/${view}`,
			{ method: 'PUT', body: blob, headers: { 'content-type': 'image/jpeg' } },
		);
		if (!res.ok) return res.error.message;
	}
	return null;
}

/** Sends every drawn photo not yet sent to the saved ride, one at a time. */
async function flush() {
	const id = keepId;
	const mine = ride;
	if (!id) return;
	for (const photo of photos) {
		if (sent.has(photo.n)) continue;
		sent.add(photo.n);
		const error = await upload(id, photo);
		if (mine !== ride) return;
		if (error) {
			sent.delete(photo.n);
			keeping = { ...keeping, error };
			// A background result that did not happen: the toast sounds the fault.
			toasts.push(`Your photos are not on the ride's page yet. ${error}`, {
				tone: 'error',
				seconds: 0,
				action: { label: 'Retry', run: () => void worldPicture.retry() },
			});
			return;
		}
		keeping = { kept: keeping.kept + 1, error: null };
	}
}

export const worldPicture = {
	/** You on the road: the latest photo's, else the best moment's. */
	get rider() {
		return (photos.at(-1) ?? best)?.rider ?? null;
	},
	/** The same moment from above. */
	get above() {
		return (photos.at(-1) ?? best)?.above ?? null;
	},
	/** The rider's own photos, drawn, in the order taken. */
	get photos(): readonly Photo[] {
		return photos;
	},
	/** Photos the rider took on this ride, so the phone remote's Photo can say it took one (#4253). */
	get taken() {
		return taken;
	},
	/** Whether the ride has room for another photo. */
	get canTake() {
		return taken < MaxRidePhotos;
	},
	/** The world is drawing the pictures: the closing card holds their place. */
	get drawing() {
		return drawing > 0;
	},
	/** How the photos are getting to the ride's page. */
	get keeping(): Keeping {
		return keeping;
	},
	/** The rider took a photo: its number on the ride, or null at the cap. */
	took(): number | null {
		if (taken >= MaxRidePhotos) return null;
		return ++taken;
	},
	/**
	 * Draws `jobs` one after another, keeping each as it lands, unless a new
	 * ride started meanwhile. A photo's pair replaces that photo; the best
	 * moment's replaces the last best pair, always as a pair and never one
	 * beside an older close's, and a close that drew neither keeps the last.
	 */
	async drawAll(jobs: readonly PictureJob[]) {
		const mine = ride;
		drawing++;
		try {
			for (const job of jobs) {
				const drawn = await job.shoot().catch(() => null);
				if (mine !== ride) return;
				if (!drawn?.rider && !drawn?.above) continue;
				const pair = { rider: drawn.rider, above: drawn.above };
				if (job.n === null) best = pair;
				else {
					const n = job.n;
					photos = [...photos.filter((p) => p.n !== n), { ...pair, n }].sort(
						(a, b) => a.n - b.n,
					);
					void flush();
				}
			}
		} finally {
			if (mine === ride) drawing--;
		}
	},
	/** The best moment's pair that `shots` will be (drawAll with one job). */
	draw(shots: Promise<WorldShots | null>) {
		return this.drawAll([{ n: null, shoot: () => shots }]);
	},
	/** The ride was saved as `rideId`: its photos go to its page, now and as they are drawn. */
	keepWith(rideId: string) {
		if (keepId !== rideId) {
			keepId = rideId;
			sent = new Set();
			keeping = { kept: 0, error: null };
		}
		return flush();
	},
	/** Tries the photos that did not get there again. */
	retry() {
		keeping = { ...keeping, error: null };
		return flush();
	},
	/** A new ride starts without the last one's pictures. Photos already on their way still land on the ride they were taken on. */
	clear() {
		ride++;
		photos = [];
		best = null;
		taken = 0;
		drawing = 0;
		keepId = null;
		sent = new Set();
		keeping = { kept: 0, error: null };
	},
};

export const PICTURE = {
	/** Ridden this long first: the start arch and the count-in are not the ride. */
	settleS: 30,
	/** Strava's portrait, drawn at one pixel per pixel. */
	width: 1080,
	height: 1350,
	quality: 0.9,
	/** The view from above (#4431): the riding view's landscape, the portrait's pixels turned on their side. */
	above: { width: 1350, height: 1080 },
	/** A summit is drawn this far below its top: you cresting it, the climb behind you. */
	belowTopM: 20,
};
/** Half the stretch a grade is read over: one sample is too noisy. */
const AROUND_M = 50;

/** A moment of the ride the picture can be drawn at: where, the light then, and your watts. */
export type PictureMoment = { m: number; p: number | null; watts: number };

/** The moment the picture is drawn at: the one the rider took, else the ride's best. */
export function momentToDraw(
	took: PictureMoment | null,
	route: Route | null,
	ridden: readonly PictureMoment[],
): PictureMoment | null {
	return took ?? (route && bestMoment(route, ridden));
}

/**
 * The ride's best moment, chosen when it ends from `ridden`, the moments
 * logged in order once it settled: the highest summit you crossed, else
 * the highest hairpin you rode through, else the steepest stretch. Null
 * when nothing was logged.
 */
export function bestMoment(
	route: Route,
	ridden: readonly PictureMoment[],
): PictureMoment | null {
	if (ridden.length === 0) return null;
	const lap = (m: number) =>
		route.loop ? ((m % route.length) + route.length) % route.length : m;
	/** The moment you passed metre `d` of the road, at the light and watts you rode it in. */
	const passed = (d: number): PictureMoment | null => {
		for (let k = 1; k < ridden.length; k++) {
			const a = lap(ridden[k - 1].m);
			const b = lap(ridden[k].m);
			// Across a lap's seam the pair spans the end and the start.
			const over = route.loop && b < a ? d > a || d <= b : a < d && d <= b;
			if (over) return { ...ridden[k - 1], m: d };
		}
		return null;
	};
	const highest = (ds: number[]) => {
		let best: PictureMoment | null = null;
		let top = -Infinity;
		for (const d of ds) {
			const moment = passed(d);
			if (moment && at(route, d).ele > top) {
				best = moment;
				top = at(route, d).ele;
			}
		}
		return best;
	};
	const tops = route.climbs.map((c) => c.topM - PICTURE.belowTopM);
	const summit = highest(tops.filter((d) => d > 0));
	if (summit) return summit;
	const hairpin = highest(hairpinsOf(route.road));
	if (hairpin) return hairpin;
	const grade = (m: number) =>
		at(route, lap(m) + AROUND_M).ele - at(route, lap(m) - AROUND_M).ele;
	const steepest = ridden.reduce((a, b) => (grade(b.m) > grade(a.m) ? b : a));
	return { ...steepest, m: lap(steepest.m) };
}
