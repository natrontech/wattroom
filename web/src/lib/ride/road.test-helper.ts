import type { Route } from '$lib/road/route';

/**
 * A straight road with these grades, one per 10 m sample — just enough of a
 * Route for the grade lookups the trainer's side makes. Made up on purpose,
 * like $lib/road/fixtures: no real route enters the repo.
 */
export function gradedRoad(grades: number[]): Route {
	const n = grades.length;
	const x = Float64Array.from({ length: n }, (_, i) => i * 10);
	return {
		step: 10,
		length: (n - 1) * 10,
		loop: false,
		x,
		z: new Float64Array(n),
		ele: new Float64Array(n),
		grade: Float64Array.from(grades),
	} as unknown as Route;
}

/** `metres` of road at `grade`, in 10 m samples. */
export const stretch = (grade: number, metres: number): number[] =>
	Array.from({ length: Math.round(metres / 10) }, () => grade);
