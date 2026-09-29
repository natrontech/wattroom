// An art style is data: the same World drawn with different colours, lines
// and light. One light chunk shades every terrain — soft bands, a violet
// shadow tint (never black), sky fill, baked AO, fog that warms toward the
// sun — and the sky's horizon IS the fog colour, so land dissolves into sky.
//
// The colours themselves are the caller's: this module knows the shape of a
// style, never its values, so the engine carries no palette of its own.
import * as THREE from 'three';
import type { Biome } from './biome';
import type { SignLook } from './setpieces';

export type Palette = Record<Biome, string>;

export type PropColors = {
	spruce: string;
	spruceTip: string;
	leaf: string;
	leafLight: string;
	trunk: string;
	wall: string;
	wood: string;
	roof: string;
	stone: string;
	cow: string;
	cowPatch: string;
	bell: string;
	bale: string;
	baleLight: string;
	post: string; // road posts and delineators
	band: string; // the black band on a post
	reflector: string;
	pole: string; // the grey of signposts and flagpoles
	hiking: string; // the yellow Swiss hiking sign
	water: string;
	snowpole: string;
	flags: readonly string[]; // one per summit flagpole
	rock: string;
};

// The bits of a rider that are not identity: shoes, tyres, rims, metal, lenses.
export type RiderKit = {
	shoe: string;
	tyre: string;
	rim: string;
	metal: string;
	glasses: string;
};

export type Style = {
	id: string;
	label: string;
	ride: boolean; // cave-safe: legible live watts on it (ADR-0005); desk-only otherwise
	sky: { top: string; horizon: string; sunward: string };
	sun: {
		elevation: number; // degrees
		azimuth: number; // degrees
		disc: 'halo' | 'stripes' | 'none';
		color: string;
		low?: string; // the bottom of a striped disc; `color` is its top
	};
	fogK: number; // extinction per metre
	bands: number; // 0 = smooth, 1 = unlit, 2–3 = soft cel bands
	shade: string; // shadow tint
	skyFill: number;
	key: string; // sunlight colour on props
	palette: Palette;
	grid: { color: string; size: number; alpha: number } | null; // flats only
	contours: { color: string; index: string; step: number } | null;
	imhof: { valley: string; peak: string } | null; // relief-map shading instead of bands
	road: { asphalt: string; line: string; verge: string };
	props: PropColors;
	kit: RiderKit;
	zones: readonly string[]; // Z1–Z7: the flat ring under each rider
	trail: string | null; // the one glow: your live power leaves light
	plinth: string | null; // the model base under the world (desk views)
	backdrop: { ridge: string; rock: string; snow: string; snowCaps: boolean };
	stars: string | null;
	signs: Record<SignLook, { bg: string; fg: string; post: string }>;
	arch: { chrome: string; panel: string; stripe: string; text: string };
};

export function sunDir(style: Style): THREE.Vector3 {
	const e = (style.sun.elevation * Math.PI) / 180;
	const a = (style.sun.azimuth * Math.PI) / 180;
	return new THREE.Vector3(
		Math.sin(a) * Math.cos(e),
		Math.sin(e),
		-Math.cos(a) * Math.cos(e),
	).normalize();
}

const col = (s: string | undefined) =>
	s ? new THREE.Color(s) : new THREE.Color(0, 0, 0);

// The shared light: one chunk, every terrain, every style.
export function terrainMaterial(style: Style): THREE.ShaderMaterial {
	return new THREE.ShaderMaterial({
		uniforms: {
			uSun: { value: sunDir(style) },
			uKey: { value: col(style.key) },
			uShade: { value: col(style.shade) },
			uSkyTop: { value: col(style.sky.top) },
			uHorizon: { value: col(style.sky.horizon) },
			uSunward: { value: col(style.sky.sunward) },
			uFogK: { value: style.fogK },
			uBands: { value: style.bands },
			uSkyFill: { value: style.skyFill },
			uGridColor: { value: col(style.grid?.color) },
			uGridSize: { value: style.grid?.size ?? 1 },
			uGridAlpha: { value: style.grid?.alpha ?? 0 },
			uContour: { value: col(style.contours?.color) },
			uIndex: { value: col(style.contours?.index) },
			uContourStep: { value: style.contours?.step ?? 0 },
			uImhof: { value: style.imhof ? 1 : 0 },
			uValley: { value: col(style.imhof?.valley) },
			uPeak: { value: col(style.imhof?.peak) },
		},
		vertexColors: true,
		vertexShader: /* glsl */ `
			attribute float ao;
			varying vec3 vColor; varying vec3 vPos; varying float vAo;
			void main() {
				vColor = color; vAo = ao;
				vec4 world = modelMatrix * vec4(position, 1.0);
				vPos = world.xyz;
				gl_Position = projectionMatrix * viewMatrix * world;
			}`,
		fragmentShader: /* glsl */ `
			uniform vec3 uSun, uKey, uShade, uSkyTop, uHorizon, uSunward, uGridColor, uContour, uIndex, uValley, uPeak;
			uniform float uFogK, uBands, uSkyFill, uGridSize, uGridAlpha, uContourStep, uImhof;
			varying vec3 vColor; varying vec3 vPos; varying float vAo;
			void main() {
				vec3 n = normalize(cross(dFdx(vPos), dFdy(vPos)));
				float dist = length(vPos - cameraPosition);
				vec3 base = vColor;
				vec3 col;
				if (uImhof > 0.5) {
					float hs = clamp(dot(n, normalize(vec3(-1.0, 1.4, -1.0))), 0.0, 1.0);
					col = mix(uValley, uPeak, hs) * (base / max(max(base.r, base.g), max(base.b, 0.001)) * 0.12 + 0.88);
				} else {
					float lam = dot(n, uSun) * 0.5 + 0.5; // half-Lambert
					if (uBands > 1.5) {
						float fw = fwidth(lam) * (1.0 + dist / 800.0); // soft band edges, blurred with distance so far facets never crawl
						float q = lam * uBands;
						lam = (floor(q) + smoothstep(0.5 - fw * uBands, 0.5 + fw * uBands, fract(q))) / uBands;
					} else if (uBands > 0.5) lam = 0.72;
					vec3 lit = base * mix(uShade * 2.2 + 0.15, uKey, lam); // shadow is the tint, never black
					col = lit + base * uSkyTop * uSkyFill * max(n.y, 0.0);
				}
				col *= mix(0.55, 1.0, vAo);
				if (uGridAlpha > 0.0) { // synthwave: a disciplined grid on the flats only, fading by 3 km
					vec2 gq = vPos.xz / uGridSize;
					vec2 g = abs(fract(gq - 0.5) - 0.5) / fwidth(gq);
					float line = (1.0 - min(min(g.x, g.y), 1.0)) * smoothstep(0.93, 0.97, n.y) * (1.0 - smoothstep(1500.0, 3000.0, dist));
					col = mix(col, uGridColor, line * uGridAlpha);
				}
				if (uContourStep > 0.0) { // contours that vanish before they are denser than the pixels
					float h = vPos.y / uContourStep;
					float fh = fwidth(h);
					float c = (1.0 - smoothstep(0.0, 1.5 * fh, abs(fract(h - 0.5) - 0.5))) * (1.0 - smoothstep(0.25, 0.6, fh));
					float hi = vPos.y / (uContourStep * 5.0);
					float fi = fwidth(hi);
					float ci = (1.0 - smoothstep(0.0, 3.0 * fi, abs(fract(hi - 0.5) - 0.5))) * (1.0 - smoothstep(0.4, 1.2, fi * 5.0));
					col = mix(col, uContour, c * 0.8);
					col = mix(col, uIndex, ci);
				}
				vec3 view = normalize(vPos - cameraPosition);
				vec3 fogCol = mix(uHorizon, uSunward, pow(max(dot(view, uSun), 0.0), 8.0));
				vec3 ext = exp(-dist * uFogK * vec3(1.3, 1.0, 0.75)); // red fades first: aerial perspective
				gl_FragColor = vec4(mix(fogCol, col, ext), 1.0);
				#include <colorspace_fragment>
			}`,
	});
}

// A sky whose horizon is exactly the fog colour; a halo toward a low sun, or
// a flat striped disc for synthwave — never bloomed, never a glow.
export function skyMaterial(style: Style): THREE.ShaderMaterial {
	return new THREE.ShaderMaterial({
		side: THREE.BackSide,
		depthWrite: false,
		fog: false,
		dithering: true,
		uniforms: {
			uTop: { value: col(style.sky.top) },
			uHorizon: { value: col(style.sky.horizon) },
			uSunward: { value: col(style.sky.sunward) },
			uSun: { value: sunDir(style) },
			uSunCol: { value: col(style.sun.color) },
			uSunLow: { value: col(style.sun.low ?? style.sun.color) },
			uDisc: {
				value:
					style.sun.disc === 'stripes' ? 2 : style.sun.disc === 'halo' ? 1 : 0,
			},
		},
		vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
		fragmentShader: /* glsl */ `uniform vec3 uTop, uHorizon, uSunward, uSun, uSunCol, uSunLow; uniform float uDisc; varying vec3 vDir;
			void main(){
				float h = max(vDir.y, 0.0);
				float s = max(dot(vDir, uSun), 0.0);
				vec3 hor = mix(uHorizon, uSunward, pow(s, 8.0));
				vec3 c = mix(hor, uTop, pow(h, 0.45));
				if (uDisc > 0.5) c += uSunward * pow(s, 6.0) * 0.35 + hor * exp(-abs(vDir.y) * 14.0) * 0.12;
				if (uDisc > 1.5) { // the outrun sun: flat disc, horizontal gaps widening toward the bottom
					vec3 toSun = vDir - uSun;
					float r = length(toSun);
					if (r < 0.16) {
						float y = (vDir.y - uSun.y) / 0.16; // -1 bottom … 1 top
						float gap = step(0.0, -y) * step(0.55 + y * 0.35, fract(y * 7.0));
						vec3 disc = mix(uSunLow, uSunCol, y * 0.5 + 0.5);
						c = mix(c, disc, (1.0 - gap) * (1.0 - smoothstep(0.155, 0.16, r)));
					}
				}
				gl_FragColor = vec4(c, 1.0);
				#include <colorspace_fragment>
			}`,
	});
}
