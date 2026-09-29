import { readFileSync } from 'node:fs';

export interface GoldenLeg {
	seconds: number;
	watts: number;
	grade: number;
	shelter: number;
	/** m/s at the end of the leg */
	speed: number;
	/** metres from the start of the vector */
	distance: number;
}

export interface GoldenVector {
	name: string;
	cda: number;
	mass: number;
	/** m/s at the start */
	speed: number;
	/** Where the road bends (#3204), metres from the vector's start. */
	bends?: { fromM: number; toM: number; radiusM: number }[];
	legs: GoldenLeg[];
}

/** The resampling a vector's bends are read at — the Go test's bendStep. */
export const BEND_STEP = 10;

/**
 * A vector's bends sampled every BEND_STEP metres, two samples past the last
 * so the road runs straight after it — the Go test's curvatureOf.
 */
export function curvatureOf(
	bends: NonNullable<GoldenVector['bends']>,
): number[] {
	const end = Math.max(0, ...bends.map((b) => b.toM));
	return Array.from({ length: Math.ceil(end / BEND_STEP) + 3 }, (_, i) => {
		const at = i * BEND_STEP;
		const bend = bends.findLast((b) => at >= b.fromM && at <= b.toM);
		return bend ? 1 / bend.radiusM : 0;
	});
}

/**
 * The pace model's golden vectors (#3048), written by the Go twin
 * (`go test ./internal/road -run TestGolden -update`) and read by every
 * test here that has to land on the same metre.
 */
export const golden = JSON.parse(
	readFileSync(
		new URL(
			'../../../../server/internal/protocol/testdata/road-golden.json',
			import.meta.url,
		),
		'utf8',
	),
) as {
	vectors: GoldenVector[];
	/** road.Shelter's own cases (#3233), one call and its answer each. */
	shelters: {
		gapM: number;
		laneDelta: number;
		lineIndex: number;
		shelter: number;
	}[];
};

/** The one vector with this name at this CdA. */
export function goldenVector(name: string, cda: number): GoldenVector {
	const found = golden.vectors.find((v) => v.name === name && v.cda === cda);
	if (!found) throw new Error(`no golden vector "${name}" at CdA ${cda}`);
	return found;
}
