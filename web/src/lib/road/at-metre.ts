import { roadStep, type Road } from './road';

/**
 * A stored road read at a metre, exactly as the server reads it
 * (server/internal/road/profile.go): the ride's own metres and the replay
 * that keeps the record (ADR-0074) must step the same road the same way.
 */

/** The sample a metre falls after, and how far towards the next. */
function segment(road: Road, m: number): [number, number] {
	const step = roadStep(road);
	const at = Math.min(Math.max(m, 0), road.length);
	const i = Math.min(Math.floor(at / step), road.heights.length - 2);
	return [i, (at - i * step) / step];
}

/** Height m metres along the road, clamped to its ends (Go: HeightAt). */
export function heightAt(road: Road, m: number): number {
	const [i, t] = segment(road, m);
	return road.heights[i] + (road.heights[i + 1] - road.heights[i]) * t;
}

/** The grade in % of the stretch m metres along the road (Go: GradeAt). */
export function gradeAt(road: Road, m: number): number {
	const [i] = segment(road, m);
	return ((road.heights[i + 1] - road.heights[i]) / roadStep(road)) * 100;
}
