import { describe, expect, it } from 'vitest';
import { Biome } from './biome';
import { terrainMaterial } from './styles';
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
		// No detail painted inside a face: no noise, no masonry.
		expect(f).not.toMatch(/noise|hash|fract\(sin/);
	});
});
