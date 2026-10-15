import { describe, expect, it } from 'vitest';
import { Biome } from './biome';
import { OBJECT_FOG_K, terrainMaterial } from './styles';
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
		expect(f).toContain('smoothstep(0.86, 0.66, n.y');
		expect(f).toContain('mix(base, stone, steep)');
		expect(f).toContain('vPos.y');
	});
});

describe('the scene fog agrees with the ground’s (#3222)', () => {
	it('fades a prop at a density inside the terrain shader’s per-channel range', () => {
		const m = /uFogK \* vec3\(([\d.]+), ([\d.]+), ([\d.]+)\)/.exec(
			terrainMaterial(RIDE).fragmentShader,
		);
		const k = m!.slice(1).map(Number);
		expect(OBJECT_FOG_K).toBeGreaterThanOrEqual(Math.min(...k));
		expect(OBJECT_FOG_K).toBeLessThanOrEqual(Math.max(...k));
	});
});
