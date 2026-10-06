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
 * front, z across; on a sleeve, (along it from the shoulder joint as a
 * share of the arm, round it, side).
 * Every edge is anti-aliased by its own footprint (`aa`), so a pattern never
 * crawls at chase distance.
 */
export const JERSEY_GLSL = /* glsl */ `
uniform float uPattern;
uniform float uTorso;
uniform vec3 uJerseyB;
uniform vec3 uJerseyC;
const float DOT_M = 0.06; // metres between Gipfelpunkte's dots
const float RAGLAN = 0.2; // how far down the side the shoulder seam runs from the collar
const float SEAM_V = 0.95; // where it meets the collar
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
			// Dots laid out by arc length round the body, so they stay round where the torso narrows; they fade before the hem and the collar turn away.
			float row = floor(pc.y / DOT_M);
			float arc = u * 6.2831853 * length(pc.xz) / DOT_M + row * 0.5;
			// A dot by the shoulder seam goes whole, judged at its own middle, never sliced.
			float r = length(pc.xz);
			float uc = (floor(arc) + 0.5 - row * 0.5) * DOT_M / (6.2831853 * r);
			float zc = r * sin(6.2831853 * uc) / (0.34 * uTorso);
			float vc = (row + 0.5) * DOT_M / uTorso;
			b = inside(length(vec2(fract(arc), fract(pc.y / DOT_M)) - 0.5) - 0.28) * smoothstep(-0.06, 0.02, v) * step(vc + RAGLAN * min(abs(zc), 1.0), SEAM_V);
		}
		// A raglan seam: from the collar down to the underarm the shoulder is plain, where the cloth turns into the armhole and a pattern would break up.
		if (p != 1 && p != 8 && p != 11) {
			float plain = inside(v + RAGLAN * min(abs(z), 1.0) - SEAM_V);
			b *= plain;
			c *= plain;
		}
	} else if (p == 1 || p == 7 || p == 8) b = 1.0; // the yoke's, the fade's top or the upper block's colour runs down the sleeve
	else {
		// Down the sleeve from the shoulder joint, at the torso's spacing; the cap over the shoulder keeps the main colour, a seam with a clean edge.
		float s = pc.x;
		// The cap ends where the sleeve's first hoop begins: one edge, no sliver.
		float arm = aa(0.0, s - 1.0 / 12.0);
		float hoop = inside(abs(fract(s * 6.0 - 0.5) - 0.25) - 0.25);
		float stripe = inside(abs(fract(pc.y * 8.0) - 0.25) - 0.25);
		if (p == 3) b = hoop;
		else if (p == 5) b = stripe;
		else if (p == 9) b = hoop + stripe - 2.0 * hoop * stripe;
		// ponytail: the one row a short sleeve holds whole, between the cap and the cuff; a long sleeve's further rows wait for its end as a uniform.
		else if (p == 11) b = inside(length(fract(vec2(pc.y * 4.0 + floor(s * 10.0) * 0.5, s * 10.0)) - 0.5) - 0.28) * step(abs(floor(s * 10.0) - 1.0), 0.5);
		b *= arm;
	}
	return mix(mix(a, uJerseyB, b), uJerseyC, c);
}
`;
