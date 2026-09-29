/**
 * The cadence a rider without a cadence sensor pedals at, from their effort
 * (docs/SPEC.md "Rider animation": the jukebox's effort tiers).
 */
export function effortRpm(watts: number, ftp: number): number {
	const r = watts / Math.max(ftp, 1);
	return r <= 0.55 ? 80 : r <= 0.75 ? 85 : r <= 0.9 ? 90 : 95;
}
