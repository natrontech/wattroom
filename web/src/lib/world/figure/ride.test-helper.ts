import type { RideInput } from './animator';

export const DT = 1 / 60;

/** A seeded wobble, so a noisy ride is the same noisy ride every run. */
function noise(seed: number) {
	return () => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed / 2 ** 32 - 0.5;
	};
}

/** A ride that spends time near every threshold: sprints, a climb, a descent, a stop. */
export function ride(seconds: number, seed = 7): RideInput[] {
	const n = noise(seed);
	return Array.from({ length: Math.round(seconds / DT) }, (_, i) => {
		const t = i * DT;
		const leg = Math.floor(t / 20) % 6;
		// prettier-ignore
		const base = [
			{ power: 200, cadence: 90, speed: 9, grade: 0 },
			{ power: 390, cadence: 105, speed: 13, grade: 0, sprint: true }, // around the sprint's entry
			{ power: 210, cadence: 70, speed: 4, grade: 5 }, // around the climb's entry
			{ power: 0, cadence: 0, speed: 14, grade: -4 }, // around the tuck's entry
			{ power: 20, cadence: 5, speed: 0.4, grade: 0 }, // around a stop
			{ power: 150, speed: 8, grade: 0, curvature: 0.05 }, // no cadence from the trainer
		][leg];
		return {
			...base,
			ftp: 250,
			power: base.power * (1 + 0.3 * n()),
			cadence:
				base.cadence === undefined ? undefined : base.cadence * (1 + 0.2 * n()),
			speed: base.speed * (1 + 0.1 * n()),
			grade: base.grade + n(),
		};
	});
}
