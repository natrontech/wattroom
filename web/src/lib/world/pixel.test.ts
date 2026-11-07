import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DIORAMA, rampAll } from './pixel';

/** The shader `m` compiles from three's `lib` once ramped. */
function ramped(m: THREE.Material, lib: 'lambert' | 'toon') {
	rampAll(new THREE.Mesh(new THREE.BoxGeometry(), m));
	const shader = {
		uniforms: {},
		vertexShader: THREE.ShaderLib[lib].vertexShader,
		fragmentShader: THREE.ShaderLib[lib].fragmentShader,
	} as unknown as THREE.WebGLProgramParametersWithUniforms;
	m.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
	return shader;
}

describe('rampAll', () => {
	it("steps a Lambert material's sun, and keys its program apart", () => {
		const m = new THREE.MeshLambertMaterial();
		const before = m.customProgramCacheKey();
		const shader = ramped(m, 'lambert');
		// A three.js upgrade that rewords either chunk would leave these out without a sound.
		expect(shader.fragmentShader).toContain(
			'dotNL = pixelStep( dot( geometryNormal',
		);
		expect(shader.uniforms).toHaveProperty('uDiorama', DIORAMA);
		expect(m.customProgramCacheKey()).toBe(`pixel|${before}`);
	});
	it("steps a rider's toon light, and lets the figure's own chunks step too", () => {
		const shader = ramped(new THREE.MeshToonMaterial(), 'toon');
		expect(shader.fragmentShader).toContain(
			'return vec3( pixelStep( dotNL * 0.5 + 0.5 ) )',
		);
		expect(shader.fragmentShader).toContain('#define PIXEL_RAMP');
		expect(shader.fragmentShader).toContain('hemiDiffuseWeight = floor(');
	});
});
