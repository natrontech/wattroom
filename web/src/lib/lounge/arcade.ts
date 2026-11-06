/**
 * Bergpreis, the room's arcade game: thirty seconds up a hill on one button.
 * Hold to push and the needle rises, let go and it falls. The band drifts as
 * the road changes, and you climb fast only while the needle is inside it;
 * stay in and you climb faster still.
 */
export const RUN_SEC = 30;
/** The band's width, of a meter that runs 0 to 1. */
export const BAND = 0.26;
const RISE = 1.4;
const FALL = 0.9;
/** Metres a second out of the band, in it, and the most a streak adds. */
const CRAWL = 2;
const CLIMB = 10;
const STREAK = 10;
/** Seconds in the band for the whole of that. */
const STREAK_SEC = 5;

export interface Run {
	t: number;
	power: number;
	metres: number;
	/** Seconds in the band without leaving it. */
	streak: number;
}

export const newRun = (): Run => ({ t: 0, power: 0.3, metres: 0, streak: 0 });

/** Where the band's middle is at a moment: two slow waves, the road's grade. */
export const bandAt = (t: number): number =>
	0.5 + 0.28 * Math.sin(t * 0.8) + 0.1 * Math.sin(t * 2.1 + 1);

export const inBand = (r: Run): boolean =>
	Math.abs(r.power - bandAt(r.t)) <= BAND / 2;

export const over = (r: Run): boolean => r.t >= RUN_SEC;

/** The score a run ends on: ten for every metre. */
export const scoreOf = (r: Run): number => Math.floor(r.metres * 10);

/** One step of `dt` seconds, with the button held or not. */
export function step(r: Run, dt: number, held: boolean): Run {
	if (over(r)) return r;
	const power = Math.min(1, Math.max(0, r.power + (held ? RISE : -FALL) * dt));
	const next = { ...r, t: Math.min(RUN_SEC, r.t + dt), power };
	const hit = inBand(next);
	next.streak = hit ? r.streak + dt : 0;
	const speed = hit
		? CLIMB + STREAK * Math.min(1, next.streak / STREAK_SEC)
		: CRAWL;
	next.metres = r.metres + speed * dt;
	return next;
}
