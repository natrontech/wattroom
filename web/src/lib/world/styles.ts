// An art style is data: the same World drawn with different colours, lines
// and light. One light chunk shades every terrain, flat per face (ADR-0092)
// — soft bands under a sun that is up, the sky's soft light once it has set,
// a shadow tint (never black), sky fill, baked AO, fog that leans toward the
// sun — and the sky's horizon IS the fog colour, so land dissolves into sky.
//
// The colours themselves are the caller's: this module knows the shape of a
// style, never its values, so the engine carries no palette of its own. How
// the light falls is light.ts's; the shaders here take it as uniforms.
import * as THREE from 'three';
import { Biome } from './biome';
import { sunDir, type Light } from './light';
import { lightsUniforms, POOL, type Lights } from './lights';
import { DIORAMA } from './pixel';
import { BORE_BOXES, TUBE } from './structure-sizes';
import type { SignLook } from './setpieces';

/** A designed scene's own ground (biome.ts): a look that names no colour for it draws it from the ones it has (geometry.ts). */
type SceneBiome = typeof Biome.Moor | typeof Biome.Dry | typeof Biome.Frost;
export type Palette = Record<Exclude<Biome, SceneBiome>, string> &
	Partial<Record<SceneBiome, string>>;

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
	shutter: string;
	flower: string;
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
	marker: string; // a pass road's yellow snow marker, banded black
	warning: string; // the red border of a Swiss danger sign (#4240), never in a watt's band
	flags: readonly string[]; // one per summit flagpole
	rock: string;
};

// The bits of a rider that are not identity: shoes, tyres, rims, metal,
// lenses, and the neutral skin every rider wears who has not chosen one.
export type RiderKit = {
	skin: string;
	shoe: string;
	tyre: string;
	rim: string;
	metal: string;
	glasses: string;
	/** A rider's tail light, lit only to answer a cheer (#3116): never danger's red, nor a watt. */
	tailLight: string;
};

export type Style = {
	id: string;
	label: string;
	ride: boolean; // cave-safe: legible live watts on it (ADR-0005); desk-only otherwise
	sky: {
		top: string;
		horizon: string; // and the fog: one colour
		sunward: string;
		band?: string; // a thin band on the horizon: the ride's peach alpenglow
	};
	sun: {
		elevation: number; // degrees; below 0 the sky alone lights the look, and the ride's progress sinks it
		sets?: number; // degrees at a ride's finish: the sun moves to it over a ride with a known end
		azimuth: number; // degrees
		disc: 'halo' | 'stripes' | 'none';
		color: string;
		low?: string; // the bottom of a striped disc; `color` is its top
	};
	fogK: number; // extinction per metre
	/** What falls, drawn over the frame by Diorama 3D's pass (diorama.ts): the room's own rain or snow. */
	weather?: 'rain' | 'snow';
	/** The room's moon, drawn in the sky once it is dark. */
	moon?: string;
	bands: number; // 0 = smooth, 1 = unlit, 2–3 = soft cel bands
	shade: string; // shadow tint
	skyFill: number;
	key: string; // the light's colour: the sun's while it is up, the sky's once it has set
	palette: Palette;
	grid: { color: string; size: number; alpha: number } | null; // flats only
	contours: { color: string; index: string; step: number } | null;
	imhof: { valley: string; peak: string } | null; // relief-map shading instead of bands
	road: { asphalt: string; line: string; verge: string; shoulder?: string }; // no shoulder: the verge runs to the asphalt
	props: PropColors;
	/** Lakes, rivers and streams (water.ts), shallows to deep and the foam at their edge: none, made from `props.water`. */
	water?: { deep: string; mid: string; shallow: string; foam: string };
	kit: RiderKit;
	zones: readonly string[]; // Z1–Z7: the flat ring under each rider
	trail: string | null; // the one glow: your live power leaves light
	plinth: string | null; // the model base under the world (desk views)
	/** `tall`: how many times the ranges stand over their usual height. */
	backdrop: {
		ridge: string;
		rock: string;
		snow: string;
		snowCaps: boolean;
		tall?: number;
	};
	stars: string | null;
	signs: Record<SignLook, { bg: string; fg: string; post: string }>;
	arch: { chrome: string; panel: string; stripe: string; text: string };
	/** A rider's name tag (#3086): a dark pill, its hairline, its words. */
	tag: { bg: string; line: string; ink: string };
};

const col = (s: string | undefined) =>
	s ? new THREE.Color(s) : new THREE.Color(0, 0, 0);

const sunOf = (style: Style) => sunDir(style.sun.elevation, style.sun.azimuth);

/**
 * Linear sRGB to OKLab and back (Ottosson). The horizon band blends there:
 * from the sky to a grey of the sky's own lightness, then to the peach, so
 * every pixel keeps either the sky's hue or the peach's — never a pink
 * between them, never a grey brighter than the sky.
 */
const OKLAB = /* glsl */ `
	vec3 toLab(vec3 c) {
		vec3 lms = pow(max(vec3(
			dot(c, vec3(0.4122214708, 0.5363325363, 0.0514459929)),
			dot(c, vec3(0.2119034982, 0.6806995451, 0.1073969566)),
			dot(c, vec3(0.0883024619, 0.2817188376, 0.6299787005))), 0.0), vec3(1.0 / 3.0));
		return vec3(
			dot(lms, vec3(0.2104542553, 0.7936177850, -0.0040720468)),
			dot(lms, vec3(1.9779984951, -2.4285922050, 0.4505937099)),
			dot(lms, vec3(0.0259040371, 0.7827717662, -0.8086757660)));
	}
	vec3 fromLab(vec3 l) {
		vec3 lms = vec3(
			dot(l, vec3(1.0, 0.3963377774, 0.2158037573)),
			dot(l, vec3(1.0, -0.1055613458, -0.0638541728)),
			dot(l, vec3(1.0, -0.0894841775, -1.2914855480)));
		lms = lms * lms * lms;
		return vec3(
			dot(lms, vec3(4.0767416621, -3.3077115913, 0.2309699292)),
			dot(lms, vec3(-1.2684380046, 2.6097574011, -0.3413193965)),
			dot(lms, vec3(-0.0041960863, -0.7034186147, 1.7076147010)));
	}`;

/**
 * Where rock comes through Diorama 3D's snow: where the land's facets (0 to 1)
 * rise over this cut, lower the more a face leans and on a crest. Over gentle
 * ground it stands over every facet, so the snow there is closed: an outcrop
 * on a flat, seen from above, read as a hole down to the stones under it.
 */
export const SNOW_ROCK_CUT = {
	flat: '1.04',
	lean: '2.4',
	crest: '0.5',
} as const;
/** The lean (|n.xz|) over which a snow face takes the sun's warmth or the shade's lilac: none on a flat, so it is not a patchwork of its faces. */
export const SNOW_TINT_LEAN = ['0.15', '0.45'] as const;
/** The cut at a face's up (n.y) and crest (0 to 1), as the shader reads it. */
export const snowRockCut = (up: number, crest = 0) =>
	+SNOW_ROCK_CUT.flat -
	(1 - up) * +SNOW_ROCK_CUT.lean -
	crest * +SNOW_ROCK_CUT.crest;

/**
 * The land up close in Diorama 3D, so no floor is ever empty: fields on a turned
 * grid, each its own green, mottled in flat patches, with flowers near the
 * road. Painted on the ground by where it is, so it stays put as you ride.
 */
export const PIXEL_LAND = /* glsl */ `
	float landHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
	float landNoise(vec2 p) {
		vec2 i = floor(p), f = fract(p);
		f = f * f * (3.0 - 2.0 * f);
		return mix(mix(landHash(i), landHash(i + vec2(1.0, 0.0)), f.x),
			mix(landHash(i + vec2(0.0, 1.0)), landHash(i + vec2(1.0, 1.0)), f.x), f.y);
	}
	// Noise on a turned lattice of triangles, flat across each: its patches have straight edges, cut as a low-poly face is.
	float landFacet(vec2 p) {
		p = mat2(0.94, -0.34, 0.34, 0.94) * p;
		vec2 i = floor(p), f = fract(p);
		float a = landHash(i), d = landHash(i + vec2(1.0, 1.0));
		return f.x > f.y
			? a + (landHash(i + vec2(1.0, 0.0)) - a) * f.x + (d - landHash(i + vec2(1.0, 0.0))) * f.y
			: a + (landHash(i + vec2(0.0, 1.0)) - a) * f.y + (d - landHash(i + vec2(0.0, 1.0))) * f.x;
	}
	bool landGreen(vec3 base, float up) { return !(base.g < base.r * 1.05 || base.g < base.b * 1.02 || up < 0.8); }
	// The fields, their stripes and patches.
	vec3 landFields(vec3 base, vec3 pos, float dist) {
		vec2 turned = mat2(0.8, -0.6, 0.6, 0.8) * pos.xz;
		float field = landHash(floor(turned / vec2(58.0, 90.0)));
		vec3 c = base * (0.86 + field * 0.3);
		// Hay gone gold, and a darker field of something else.
		if (field < 0.2) c = mix(c, vec3(0.5, 0.58, 0.22), 0.34);
		else if (field > 0.84) c = mix(c, vec3(0.12, 0.36, 0.3), 0.32);
		// A mown field runs in stripes along its length, every third one of them.
		if (mod(floor(field * 97.0), 3.0) < 1.0 && dist < 900.0)
			c *= mod(floor(turned.x / 5.0), 2.0) < 1.0 ? 1.0 : 1.07;
		// Fine patches up close, broad ones further off, none past where a pixel is wider than a patch: noise, there.
		float patchy = mix(landNoise(pos.xz / 11.0) * 0.7 + (dist < 70.0 ? landNoise(pos.xz / 3.6) * 0.3 : 0.15), 0.48, smoothstep(250.0, 400.0, dist));
		if (patchy > 0.6) c = c * 1.14 + vec3(0.012, 0.022, 0.0);
		else if (patchy < 0.36) c *= 0.86;
		return c;
	}
	/** A round dot in each cell of q whose hash passes over, size of the cell across: its hash, or -1 off it. */
	float landDot(vec2 q, float over, float size) {
		float k = landHash(floor(q));
		float fw = length(fwidth(q)) * 0.5;
		float r = length(fract(q) - 0.5);
		return k > over && r < size * 0.5 - fw ? k : -1.0;
	}
	// Snow: rock coming through it, more where it is steep and along the crests the wind scours,
	// each outcrop in a ring of scoured, bluer snow and snow lying on its top; long drifts across
	// the slope. A face turned to the sun warmer, one turned away cooler and lilac, in the sky's own
	// colours, so the mountain's form reads from overhead in any light: the whole face, rock and
	// snow alike, so an outcrop lies on the face and never shows through it as through a sheet.
	// Gentle ground is one closed sheet: no rock, and no tint until a face leans like a slope.
	vec3 snowLand(vec3 c, vec3 pos, float dist, vec3 n, float crest) {
		float up = n.y;
		float lean = length(n.xz);
		float sunLean = length(uSun.xz);
		float face = lean > 1e-3 && sunLean > 1e-3
			? dot(n.xz / lean, uSun.xz / sunLean) * smoothstep(${SNOW_TINT_LEAN[0]}, ${SNOW_TINT_LEAN[1]}, lean)
			: 0.0;
		vec3 warm = uWarm / max(max(uWarm.r, uWarm.g), max(uWarm.b, 1e-3));
		vec3 cool = uShade / max(max(uShade.r, uShade.g), max(uShade.b, 1e-3));
		vec3 tint = mix(vec3(1.0), face > 0.0 ? warm : cool, abs(face) * (face > 0.0 ? 0.16 : 0.3));
		float near = 1.0 - smoothstep(1200.0, 2000.0, dist);
		float r = landFacet(pos.xz / 30.0) * 0.72 + landFacet(pos.xz / 11.0 + 17.0) * 0.28;
		float cut = ${SNOW_ROCK_CUT.flat} - (1.0 - up) * ${SNOW_ROCK_CUT.lean} - crest * ${SNOW_ROCK_CUT.crest};
		float fw = fwidth(r) + 1e-4;
		float rock = max(smoothstep(cut - fw, cut + fw, r) * near, crest * (1.0 - near) * 0.55);
		float rim = smoothstep(cut - 0.07 - fw, cut - 0.07 + fw, r) * near;
		float drift = landNoise(vec2(pos.x * 0.045 + pos.z * 0.02, pos.z * 0.11 - pos.x * 0.035)) * (1.0 - smoothstep(500.0, 800.0, dist));
		float fd = fwidth(drift) + 1e-4;
		c = mix(c, c * vec3(0.93, 0.93, 1.0), smoothstep(0.64 - fd, 0.64 + fd, drift));
		c = mix(c, c * vec3(0.86, 0.86, 0.97), rim);
		vec3 stone = mix(uRock, c, 0.18);
		float cap = landFacet(pos.xz / 3.0 + 5.0);
		float fc = fwidth(cap) + 1e-4;
		float capped = smoothstep(0.6 - fc, 0.6 + fc, cap) * (1.0 - smoothstep(200.0, 400.0, dist));
		return mix(c, mix(stone, c, capped * 0.8), rock) * tint;
	}
	// Rock: a cliff in strata, a darker band every few metres of its height; at its foot, scree.
	vec3 rockLand(vec3 c, vec3 pos, float dist, float up, float bare) {
		float s = pos.y / 3.4 + landNoise(pos.xz / 18.0) * 1.6;
		float fs = fwidth(s) + 1e-4;
		float strata = (1.0 - smoothstep(0.22 - fs, 0.22 + fs, fract(s))) * smoothstep(0.86, 0.7, up) * (1.0 - smoothstep(500.0, 800.0, dist));
		c *= 1.0 - 0.13 * strata;
		float k = landDot(pos.xz / 1.3, 0.5, 0.36 + 0.1 * landHash(floor(pos.xz / 1.3) + 3.0));
		float scree = step(0.0, k) * bare * smoothstep(0.7, 0.86, up) * (1.0 - smoothstep(90.0, 140.0, dist));
		return mix(c, c * (k > 0.78 ? 1.18 : 0.84), scree);
	}
	// Alpine pasture and dry ground: heather in lilac patches, a stone now and then.
	vec3 sparseLand(vec3 c, vec3 pos, float dist) {
		float h = landFacet(pos.xz / 8.0 + 41.0);
		float fh = fwidth(h) + 1e-4;
		float heather = smoothstep(0.66 - fh, 0.66 + fh, h) * (1.0 - smoothstep(400.0, 700.0, dist));
		c = mix(c, c * vec3(0.92, 0.84, 0.96), heather);
		float k = landDot(pos.xz / 3.0, 0.9, 0.24);
		return mix(c, mix(uRock, vec3(0.92, 0.9, 1.0), 0.22), step(0.0, k) * (1.0 - smoothstep(80.0, 130.0, dist)));
	}
	// A bog: dark pools, tussocks, and cotton grass white over it near the road.
	vec3 moorLand(vec3 c, vec3 pos, float dist) {
		// Its grass gone olive and rust, not the grey of the map's bog.
		c *= vec3(1.1, 1.08, 0.84);
		float pool = landFacet(pos.xz / 3.6 + 31.0);
		float fp = fwidth(pool) + 1e-4;
		c = mix(c, vec3(0.1, 0.16, 0.3), smoothstep(0.8 - fp, 0.8 + fp, pool) * (1.0 - smoothstep(250.0, 400.0, dist)));
		c = mix(c, c * 1.12, step(landNoise(pos.xz / 2.2), 0.3) * 0.6 * (1.0 - smoothstep(150.0, 300.0, dist)));
		float k = landDot(pos.xz / 0.8, 0.9, 0.28);
		return mix(c, vec3(0.96, 0.95, 0.9), step(0.0, k) * step(pool, 0.7) * (1.0 - smoothstep(35.0, 60.0, dist)));
	}
	// Diorama 3D: each cover its own (cover: snow, rock, alpine or dry, bog), flowers in the grass as dots in the world, a hand's width each, near the road.
	vec3 dioramaLand(vec3 base, vec3 pos, float dist, vec3 n, vec4 cover, float steep, float crest) {
		float up = n.y;
		vec3 c = base;
		if (cover.x > 0.5) return snowLand(c, pos, dist, n, crest);
		if (cover.y > 0.5 || steep > 0.5) c = rockLand(c, pos, dist, up, cover.y);
		if (cover.w > 0.5) return moorLand(c, pos, dist);
		if (cover.z > 0.5) return sparseLand(c, pos, dist);
		if (!landGreen(base, up)) return c;
		c = landFields(base, pos, dist);
		if (dist < 70.0) {
			vec2 q = pos.xz / 0.7;
			float k = landHash(floor(q));
			if (k > 0.86 && landNoise(floor(q) / 9.0) > 0.5) {
				float which = fract(k * 91.0);
				vec3 petal = which < 0.5 ? vec3(0.97, 0.93, 0.86) : which < 0.8 ? vec3(0.98, 0.76, 0.28) : vec3(0.92, 0.6, 0.72);
				float r = length(fract(q) - 0.5) * 0.7;
				float fw = length(fwidth(q)) * 0.5; // the cell's own scale: r jumps at a cell's edge
				c = mix(c, petal, (1.0 - smoothstep(0.07 - fw, 0.07 + fw, r)) * (1.0 - smoothstep(40.0, 70.0, dist)));
			}
		}
		return c;
	}
`;

/** Puts a light (light.ts) on the sky's or the ground's shader. */
export function setLight(m: THREE.ShaderMaterial, light: Light) {
	const u = m.uniforms;
	u.uSun.value.copy(light.sun);
	u.uDusk.value = light.dusk;
	if (u.uFrom) u.uFrom.value.copy(light.from);
	if (u.uPeach) u.uPeach.value = light.peach;
}

// The shared light: one chunk, every terrain, every style; a lamp's pool where one is lit (lights.ts).
export function terrainMaterial(
	style: Style,
	lights: Lights = lightsUniforms(),
): THREE.ShaderMaterial {
	return new THREE.ShaderMaterial({
		uniforms: {
			...lights,
			uSun: { value: sunOf(style) },
			uFrom: { value: sunOf(style) },
			uDusk: { value: 1 },
			uKey: { value: col(style.key) },
			uShade: { value: col(style.shade) },
			uSkyTop: { value: col(style.sky.top) },
			uHorizon: { value: col(style.sky.horizon) },
			uSunward: { value: col(style.sky.sunward) },
			// The sun's own colour: what a snowfield turned to it is warmed by (PIXEL_LAND snowLand).
			uWarm: { value: col(style.sun.color) },
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
			uRock: { value: col(style.palette[Biome.Rock]) },
			uDiorama: DIORAMA, // Diorama 3D: the light in soft steps (diorama.ts)
			// A tunnel's tube, cut out of the ground drawn across its mouth (setBores)
			uBoreA: {
				value: Array.from({ length: BORE_BOXES }, () => new THREE.Vector4()),
			},
			uBoreB: {
				value: Array.from({ length: BORE_BOXES }, () => new THREE.Vector4()),
			},
			uBores: { value: 0 },
			uBoreBox: { value: new THREE.Vector4() },
		},
		vertexColors: true,
		vertexShader: /* glsl */ `
			attribute float ao;
			attribute vec4 cover;
			varying vec3 vColor; varying vec3 vPos; varying float vAo; varying vec4 vCover;
			void main() {
				vColor = color; vAo = ao; vCover = cover;
				vec4 world = modelMatrix * vec4(position, 1.0);
				vPos = world.xyz;
				gl_Position = projectionMatrix * viewMatrix * world;
			}`,
		fragmentShader: /* glsl */ `
			uniform vec3 uSun, uFrom, uKey, uShade, uSkyTop, uHorizon, uSunward, uWarm, uGridColor, uContour, uIndex, uValley, uPeak, uRock;
			uniform float uFogK, uBands, uSkyFill, uGridSize, uGridAlpha, uContourStep, uImhof, uDusk, uDiorama;
			uniform vec4 uBoreA[${BORE_BOXES}]; uniform vec4 uBoreB[${BORE_BOXES}]; uniform int uBores; uniform vec4 uBoreBox;
			varying vec3 vColor; varying vec3 vPos; varying float vAo; varying vec4 vCover;
			${POOL}
			${PIXEL_LAND}
			void main() {
				// Inside a tunnel's tube at its portals no ground is drawn: each box its centre and way (a), its half length and width, height and rise (b).
				// All of them inside one box round them (uBoreBox): the rest of the land asks once.
				if (uBores > 0 && all(greaterThan(vPos.xz, uBoreBox.xy)) && all(lessThan(vPos.xz, uBoreBox.zw)))
				for (int i = 0; i < ${BORE_BOXES}; i++) {
					if (i >= uBores) break;
					vec4 a = uBoreA[i]; vec4 b = uBoreB[i];
					vec2 r = vPos.xz - a.xy;
					float s = dot(r, a.zw);
					float y = vPos.y - b.z - b.w * s;
					if (abs(s) < b.x && abs(dot(r, vec2(a.w, -a.z))) < b.y && y > -0.65 && y < ${(TUBE.crown - 0.02).toFixed(2)}) discard;
				}
				vec3 n = normalize(cross(dFdx(vPos), dFdy(vPos)));
				float dist = length(vPos - cameraPosition);
				// One colour per face (ADR-0092): its land's, or rock on a face from about 30 degrees up,
				// solid rock by the earthworks' 45 (n.y 0.71), never the ground's colour smeared down a vertical.
				float steep = smoothstep(0.86, 0.66, n.y);
				vec3 base = mix(vColor, mix(uRock, vColor, 0.18), steep);
				// A crest: the ground standing over its neighbours (land.ts shadeOf, carried as vAo), where the wind leaves rock bare.
				float crest = smoothstep(0.8, 0.97, vAo);
				if (uDiorama > 0.5) base = dioramaLand(base, vPos, dist, n, vCover, steep, crest);
				vec3 col;
				if (uImhof > 0.5) {
					float hs = clamp(dot(n, normalize(vec3(-1.0, 1.4, -1.0))), 0.0, 1.0);
					col = mix(uValley, uPeak, hs) * (base / max(max(base.r, base.g), max(base.b, 0.001)) * 0.12 + 0.88);
				} else {
					float lam = dot(n, uFrom) * 0.5 + 0.5; // half-Lambert, from the sun or, once it has set, the zenith
					if (uBands > 1.5 || uDiorama > 0.5) {
						float nb = uBands > 1.5 ? uBands : 4.0; // Diorama 3D: the room's four steps, with soft edges
						float fw = fwidth(lam) * (1.0 + dist / 800.0); // soft band edges, blurred with distance so far facets never crawl
						float q = lam * nb;
						lam = (floor(q) + smoothstep(0.5 - fw * nb, 0.5 + fw * nb, fract(q))) / nb;
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
				gl_FragColor = vec4(mix(fogCol, col, ext) * uDusk, 1.0);
				float pool = lampPool(vPos); // a third of the way to amber, the lounge's pool
				gl_FragColor.rgb = mix(gl_FragColor.rgb, uAmber, pool / 3.0);
				if (uDiorama > 0.5) gl_FragColor.a = 0.5; // the land, for the ink pass (diorama.ts)
				#include <colorspace_fragment>
			}`,
	});
}

/** The ground's cut-outs at tunnel portals (structures.ts boreBoxes), as many as it takes. */
export function setBores(
	m: THREE.ShaderMaterial,
	boxes: readonly (readonly number[])[],
) {
	const n = Math.min(BORE_BOXES, boxes.length);
	const box = [Infinity, Infinity, -Infinity, -Infinity];
	for (let i = 0; i < n; i++) {
		const [x, z, tx, tz, len, half, y, rise] = boxes[i];
		(m.uniforms.uBoreA.value as THREE.Vector4[])[i].set(x, z, tx, tz);
		(m.uniforms.uBoreB.value as THREE.Vector4[])[i].set(len, half, y, rise);
		const r = Math.hypot(len, half);
		box[0] = Math.min(box[0], x - r);
		box[1] = Math.min(box[1], z - r);
		box[2] = Math.max(box[2], x + r);
		box[3] = Math.max(box[3], z + r);
	}
	(m.uniforms.uBoreBox.value as THREE.Vector4).set(
		box[0],
		box[1],
		box[2],
		box[3],
	);
	m.uniforms.uBores.value = n;
}

// A sky whose horizon is exactly the fog colour; a thin band on the horizon
// where the look has one — the ride's peach, level behind the far ranges and
// just clearing the highest, a little taller toward the sun;
// a halo toward a low sun, or a flat striped disc for synthwave — never
// bloomed, never a glow.
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
			uBand: { value: col(style.sky.band) },
			uPeach: { value: 0 },
			uSkyline: { value: null as THREE.Texture | null }, // the far ranges' crests by bearing (backdrop.ts)
			uDusk: { value: 1 },
			uSun: { value: sunOf(style) },
			uSunCol: { value: col(style.sun.color) },
			uSunLow: { value: col(style.sun.low ?? style.sun.color) },
			uDisc: {
				value:
					style.sun.disc === 'stripes' ? 2 : style.sun.disc === 'halo' ? 1 : 0,
			},
			uMoon: { value: col(style.moon) },
			uMoonOn: { value: style.moon ? 1 : 0 },
		},
		vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
		fragmentShader: /* glsl */ `uniform vec3 uTop, uHorizon, uSunward, uBand, uSun, uSunCol, uSunLow; uniform float uDisc, uPeach, uDusk, uMoonOn; uniform vec3 uMoon; uniform sampler2D uSkyline; varying vec3 vDir;
			${OKLAB}
			void main(){
				float h = max(vDir.y, 0.0);
				float s = max(dot(vDir, uSun), 0.0);
				vec3 hor = mix(uHorizon, uSunward, pow(s, 8.0));
				vec3 c = mix(hor, uTop, pow(h, 0.45));
				if (uPeach > 0.0) { // level over the ranges in view, fading out half a degree over the highest
					float top = texture2D(uSkyline, vec2(atan(vDir.x, vDir.z) / 6.2831853, 0.5)).r * 0.25;
					float clear = 0.009 * (1.0 + 0.5 * pow(s, 4.0));
					float w = uPeach * smoothstep(-0.01, 0.0, vDir.y) * (1.0 - smoothstep(top - 0.003, top + clear, vDir.y));
					// The sky's chroma gives way to the peach's at the band's faint edge, so no pixel takes a hue between them, the pinks.
					vec3 sky = toLab(c);
					vec3 band = toLab(uBand);
					vec2 ab = w < 0.02 ? sky.yz * (1.0 - w / 0.02) : band.yz * sqrt((w - 0.02) / 0.98);
					c = fromLab(vec3(mix(sky.x, band.x, w), ab));
				}
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
				gl_FragColor = vec4(c * uDusk, 1.0);
				// The room's moon, once it is dark: flat, a bite out of it, never dimmed by the dusk.
				if (uMoonOn > 0.5 && uDusk < 0.7) {
					vec3 moon = normalize(vec3(-uSun.x, 0.55, -uSun.z));
					if (length(vDir - moon) < 0.045 && length(vDir - moon - vec3(0.018, 0.01, 0.0)) > 0.04) gl_FragColor.rgb = uMoon;
				}
				#include <colorspace_fragment>
			}`,
	});
}
