import { heightAt } from '$lib/road/at-metre';
import type { Road } from '$lib/road/road';

/**
 * The ride's one picture of the world (#4221): taken by itself on the ride,
 * drawn with no name in it (WorldScene.snap), and kept in this tab's memory
 * only. The closing card offers it beside the poster; the rider chooses
 * which to save for Strava, or both. Never uploaded, never stored.
 */
let current = $state<Blob | null>(null);
let taken = $state(0);

export const worldPicture = {
	get current() {
		return current;
	},
	/** Pictures this ride took, so the phone remote's Photo can say it took one (#4253). */
	get taken() {
		return taken;
	},
	keep(picture: Blob) {
		current = picture;
		taken++;
	},
	/** A new ride starts without the last one's picture. */
	clear() {
		current = null;
		taken = 0;
	},
};

/** docs/spec/riding.md, "The ride's pictures". */
export const PICTURE = {
	/** Ridden this long first: the start arch and the count-in are not the ride. */
	settleS: 30,
	/** A stretch this steep is a climb, the picture worth taking. */
	climbPct: 4,
	/** With no climb by then, the road as it is. */
	fallbackS: 300,
};
/** Half the stretch the grade is read over: one sample is too noisy. */
const AROUND_M = 50;

/** Whether the picture is due at metre `m` of `road`, `riddenS` seconds into riding it. */
export function pictureDue(road: Road, m: number, riddenS: number): boolean {
	if (riddenS < PICTURE.settleS) return false;
	if (riddenS >= PICTURE.fallbackS) return true;
	const rise = heightAt(road, m + AROUND_M) - heightAt(road, m - AROUND_M);
	return (rise / (2 * AROUND_M)) * 100 >= PICTURE.climbPct;
}
