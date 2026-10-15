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

	it('mixes rock in past the earthworks’ 45° face, textured along the face', () => {
		const f = m.fragmentShader;
		expect(f).toContain('smoothstep(0.80, 0.62, n.y');
		expect(f).toContain('mix(base, stone, steep)');
		expect(f).toContain('vPos.y');
	});
});
