/**
 * Invented roads for the e2e rides and the design shots, in the open South
 * Atlantic (#3054): nobody's street.
 */

/** Metres per degree of latitude; a degree of longitude is this × cos(lat). */
const PER_LAT = 111_195;

type Point = { x: number; y: number; ele: number };

/** A track from metres east (x) and north (y) of lat/lon (-lat0, -25). */
function gpx(name: string, lat0: number, points: Point[]): string {
	const perLon = PER_LAT * Math.cos((lat0 * Math.PI) / 180);
	const rows = points.map(
		({ x, y, ele }) =>
			`<trkpt lat="${(-lat0 + y / PER_LAT).toFixed(7)}" lon="${(-25 + x / perLon).toFixed(7)}"><ele>${ele.toFixed(1)}</ele></trkpt>`,
	);
	return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="WattRoom e2e" xmlns="http://www.topografix.com/GPX/1/1">
<trk><name>${name}</name><trkseg>
${rows.join('\n')}
</trkseg></trk>
</gpx>`;
}

/** Three kilometres climbing 4 %. */
export function climbGpx(): string {
	return gpx(
		'A made-up climb',
		30,
		Array.from({ length: 301 }, (_, i) => ({
			x: i * 10,
			y: 0,
			ele: 100 + 0.4 * i,
		})),
	);
}

/**
 * A pass road: a kilometre's approach at 3 %, then eight 700 m legs at 8.8 %
 * joined by seven hairpins of 25 m radius — about 7.1 km and 570 m up.
 */
export function hairpinGpx(): string {
	const points: Point[] = [];
	let x = 0;
	let y = 0;
	let ele = 400;
	const step = (dx: number, dy: number, grade: number) => {
		const run = Math.hypot(dx, dy);
		x += dx;
		y += dy;
		ele += run * grade;
		points.push({ x, y, ele });
	};
	points.push({ x, y, ele });
	for (let i = 0; i < 100; i++) step(0, -10, 0.03);
	const R = 25;
	for (let leg = 0; leg < 8; leg++) {
		const dir = leg % 2 ? -1 : 1;
		for (let i = 0; i < 70; i++) step(dir * 10, 0, 0.088);
		if (leg === 7) break;
		// Half a circle north, turning back the other way.
		const cx = x;
		const cy = y + R;
		for (let k = 1; k <= 8; k++) {
			const a = -Math.PI / 2 + (k * Math.PI) / 8;
			const nx = cx + dir * R * Math.cos(a);
			const ny = cy + R * Math.sin(a);
			step(nx - x, ny - y, 0.088);
		}
	}
	return gpx('Hairpins', 31, points);
}

/**
 * Two classed climbs, a descent and flats between, due east: 1 km flat,
 * 2 km at 6 %, 1.5 km at −5 %, 1 km flat, 1.5 km at 8 %, 500 m flat.
 */
export function rollingGpx(): string {
	const legs: [number, number][] = [
		[1000, 0],
		[2000, 6],
		[1500, -5],
		[1000, 0],
		[1500, 8],
		[500, 0],
	];
	const points: Point[] = [{ x: 0, y: 0, ele: 100 }];
	let x = 0;
	let ele = 100;
	for (const [metres, pct] of legs)
		for (let i = 0; i < metres / 10; i++) {
			x += 10;
			ele += pct / 10;
			points.push({ x, y: 0, ele });
		}
	return gpx('Rolling', 30.5, points);
}
