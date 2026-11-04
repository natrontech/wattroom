import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PIXEL, pixelScale, rampAll } from './pixel';

describe('pixelScale', () => {
	it('keeps a phone, a laptop and a TV at about 400 whole pixels along the longer side', () => {
		for (const [w, h] of [
			[375, 812],
			[812, 375],
			[1280, 800],
			[1440, 900],
			[1920, 1080],
			[2560, 1440],
			[3840, 2160],
		]) {
			const s = pixelScale(w, h);
			expect(Number.isInteger(s)).toBe(true);
			expect(Math.max(w, h) / s).toBeGreaterThanOrEqual(320);
			expect(Math.max(w, h) / s).toBeLessThanOrEqual(480);
		}
	});
	it('draws a phone held upright at 2 CSS pixels, as the lounge does, in whole pixels of its own', () => {
		expect(pixelScale(375, 812)).toBe(2);
		expect(pixelScale(1125, 2436)).toBe(6); // the same phone at 3×
	});
	it('never goes under one pixel', () => {
		expect(pixelScale(300, 200)).toBe(1);
		expect(pixelScale(0, 0)).toBe(1);
	});
});

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
	it("steps a Lambert material's sun and fog, and keys its program apart", () => {
		const m = new THREE.MeshLambertMaterial();
		const before = m.customProgramCacheKey();
		const shader = ramped(m, 'lambert');
		// A three.js upgrade that rewords either chunk would leave these out without a sound.
		expect(shader.fragmentShader).toContain(
			'dotNL = pixelStep( dot( geometryNormal',
		);
		expect(shader.fragmentShader).toContain(
			'fogFactor = pixelFog( fogFactor )',
		);
		expect(shader.uniforms).toHaveProperty('uPixel', PIXEL);
		expect(m.customProgramCacheKey()).toBe(`pixel|${before}`);
	});
	it("steps a rider's toon light, and lets the figure's own chunks step too", () => {
		const shader = ramped(new THREE.MeshToonMaterial(), 'toon');
		expect(shader.fragmentShader).toContain(
			'return vec3( pixelStep( dotNL * 0.5 + 0.5 ) )',
		);
		expect(shader.fragmentShader).toContain('#define PIXEL_RAMP');
		expect(shader.fragmentShader).toContain('hemiDiffuseWeight = floor(');
		expect(shader.fragmentShader).toContain(
			'fogFactor = pixelFog( fogFactor )',
		);
	});
});
