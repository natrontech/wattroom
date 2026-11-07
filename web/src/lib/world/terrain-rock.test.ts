import { describe, expect, it } from 'vitest';
import { Biome } from './biome';
import { PIXEL_LAND, terrainMaterial } from './styles';
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
