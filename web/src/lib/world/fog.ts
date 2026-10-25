import * as THREE from 'three';

/**
 * One fog for the whole scene (#3220 O8). The terrain shader fades by
 * exp(-d k); three's FogExp2 fades props by exp(-(d k)²), which at blue hour
 * left a prop 10 to 16 points less fogged than the ground under it at 1 to 3
 * km. `exponentialFog` swaps the fragment chunk's squared exponent for the
 * plain one, so a scene fog at `propFogDensity(fogK)` is the terrain's own
 * extinction.
 */
const SQUARED = 'fogDensity * fogDensity * vFogDepth * vFogDepth';
const LINEAR = 'fogDensity * vFogDepth';

/** The scene fog's density for a style: the terrain's extinction per metre, unscaled. */
export const propFogDensity = (fogK: number) => fogK;

/** What terrain keeps of its colour at `d` metres: styles.ts, the green channel. */
export const terrainVisibility = (d: number, fogK: number) =>
	Math.exp(-d * fogK);

/** What a prop keeps at `d` metres, read off the fog chunk three will compile. */
export function propVisibility(d: number, fogK: number): number {
	const x = propFogDensity(fogK) * d;
	return Math.exp(
		-(THREE.ShaderChunk.fog_fragment.includes(SQUARED) ? x * x : x),
	);
}

export function exponentialFog() {
	const chunk = THREE.ShaderChunk.fog_fragment;
	if (chunk.includes(SQUARED))
		THREE.ShaderChunk.fog_fragment = chunk.replace(SQUARED, LINEAR);
}
