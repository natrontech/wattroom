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
	legs: GoldenLeg[];
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
) as { vectors: GoldenVector[] };

/** The one vector with this name at this CdA. */
export function goldenVector(name: string, cda: number): GoldenVector {
	const found = golden.vectors.find((v) => v.name === name && v.cda === cda);
	if (!found) throw new Error(`no golden vector "${name}" at CdA ${cda}`);
	return found;
}
