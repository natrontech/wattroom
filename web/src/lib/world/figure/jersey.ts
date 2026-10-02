/**
 * The jersey's patterns (#3156): drawn in the figure's shader from each
 * vertex's rest-pose coordinates, so a pattern lies on the cloth and moves
 * with it, and costs no geometry and no draw. The catalogue's eleven base
 * patterns and Gipfelpunkte; any other the catalogue names is drawn plain
 * until its own drawing lands. A pattern paints the jersey's second colour
 * (b), and a few a third (c), over its main one.
 */
export const PATTERNS = [
	'plain',
	'yoke',
	'sidepanel',
	'hoops',
	'sash',
	'stripes',
	'chevron',
	'gradient',
	'blocks',
	'karo',
	'topo',
	'gipfelpunkte',
] as const;
export type Pattern = (typeof PATTERNS)[number];

/** A pattern's number in the shader; one it cannot draw is plain. */
export const patternIndex = (pattern: string): number =>
	Math.max(0, PATTERNS.indexOf(pattern as Pattern));

/**
 * `jersey(a, sp, pc)`: the jersey's colour at a vertex whose main colour is
 * `a`, in pattern space `sp` (1 the torso, 2 a sleeve). On the torso, pc is
 * the torso bone's rest space — y up the back over uTorso metres, x to the
 * front, z across; a sleeve is one colour.
 * Every edge is anti-aliased by its own footprint (`aa`), so a pattern never
 * crawls at chase distance.
 */
export const JERSEY_GLSL = /* glsl */ `
uniform float uPattern;
uniform float uTorso;
uniform vec3 uJerseyB;
uniform vec3 uJerseyC;
float inside(float d) { return 1.0 - aa(0.0, d); }
vec3 jersey(vec3 a, float sp, vec3 pc) {
	int p = int(uPattern + 0.5);
	if (p == 0) return a;
	float b = 0.0;
	float c = 0.0;
	if (sp < 1.5) {
		float v = pc.y / uTorso;
		float u = atan(pc.z, pc.x) / 6.2831853; // 0 the chest, ±0.5 the spine
		float z = pc.z / (0.34 * uTorso);
		float au = abs(u);
		if (p == 1) b = inside(0.8 - v);
		else if (p == 2) b = inside(abs(au - 0.25) - 0.08);
		else if (p == 3) b = inside(abs(fract(v * 5.0) - 0.25) - 0.25);
		else if (p == 4) b = inside(abs(z * 0.6 + v - 0.62) - 0.11);
		else if (p == 5) b = inside(abs(fract(u * 12.0) - 0.25) - 0.25);
		else if (p == 6) {
			b = inside(abs(v - 0.64 + abs(z) * 0.35) - 0.07);
			c = inside(abs(v - 0.46 + abs(z) * 0.35) - 0.045);
		} else if (p == 7) return mix(a, uJerseyB, smoothstep(0.15, 0.95, v));
		else if (p == 8) {
			b = inside(0.56 - v);
			c = inside(v - 0.2);
		} else if (p == 9) {
			float x = inside(abs(fract(u * 10.0) - 0.25) - 0.25);
			float y = inside(abs(fract(v * 7.0) - 0.25) - 0.25);
			b = x + y - 2.0 * x * y; // a checker: either band, never both
		} else if (p == 10) b = inside(abs(fract(v * 9.0 + 0.25 * sin(u * 18.85)) - 0.5) - 0.08);
		else if (p == 11) {
			vec2 f = fract(vec2(u * 14.0, v * 9.0)) - 0.5;
			b = inside(length(f) - 0.28);
		}
	} else if (p == 1 || p == 7 || p == 8) b = 1.0; // a sleeve is one colour: the yoke's, the fade's top or the upper block's
	// Every other pattern leaves the sleeve its main colour, so the torso's bands meet the shoulder seam cleanly.
	return mix(mix(a, uJerseyB, b), uJerseyC, c);
}
`;
