import { describe, expect, it } from 'vitest';
import { Biome } from './biome';
import {
	PIXEL_LAND,
	SNOW_TINT_LEAN,
	snowRockCut,
	terrainMaterial,
} from './styles';
import { RIDE } from './look.test-helper';

describe('the ground material keys rock to slope (#3728)', () => {
	const m = terrainMaterial(RIDE);

	it('hands the shader the style’s rock colour', () => {
		expect(`#${m.uniforms.uRock.value.getHexString()}`).toBe(
			RIDE.palette[Biome.Rock].toLowerCase(),
		);
	});

	it('mixes rock in past the earthworks’ 45° face, one colour per face (ADR-0092)', () => {
		const f = m.fragmentShader;
		expect(f).toContain('smoothstep(0.86, 0.66, n.y)');
		expect(f).toContain('mix(uRock, vColor, 0.18), steep)');
		// No detail painted inside a face in Smooth: no noise, no masonry. Diorama 3D's land is its own.
		expect(f.replace(PIXEL_LAND, '')).not.toMatch(/fract\(sin|landHash\(/);
	});
});

describe('Diorama 3D’s snow is closed on gentle ground', () => {
	const up = (deg: number) => Math.cos((deg * Math.PI) / 180);

	it('lets no rock through a face under 10°: the facets never reach the cut', () => {
		// landFacet is under 1, so r = 0.72 a + 0.28 b is too: a cut of 1 or more draws no outcrop.
		for (const deg of [0, 4, 8, 10])
			expect(snowRockCut(up(deg))).toBeGreaterThanOrEqual(1);
	});

	it('still shows rock on a slope and along a crest', () => {
		expect(snowRockCut(up(30))).toBeLessThan(0.75);
		expect(snowRockCut(up(5), 1)).toBeLessThan(snowRockCut(up(5)) - 0.4);
	});

	it('tints no face that lies near flat', () => {
		expect(+SNOW_TINT_LEAN[0]).toBeGreaterThanOrEqual(
			Math.sin((8 * Math.PI) / 180),
		);
	});
});
