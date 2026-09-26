// Reading a GPX: track or route points, with whatever elevation they carry.
// What the rest of the world reads is a Route (route.ts), never the file.

export type GpxPoint = { lat: number; lon: number; ele: number };

// A file this page cannot ride, in words a rider can act on.
export class GpxError extends Error {}

// ponytail: regex, not DOMParser — the same code runs in node for the tests
// and in the browser; GPX trkpt/rtept is flat enough that this holds.
export function parseGpx(text: string): { name: string; points: GpxPoint[] } {
	const name = /<name>([^<]*)<\/name>/.exec(text)?.[1]?.trim() || 'Route';
	const points: GpxPoint[] = [];
	const re = /<(?:trkpt|rtept)\b([^>]*)>([\s\S]*?)<\/(?:trkpt|rtept)>/g;
	for (let m; (m = re.exec(text));) {
		const lat = Number(/lat="([^"]+)"/.exec(m[1])?.[1]);
		const lon = Number(/lon="([^"]+)"/.exec(m[1])?.[1]);
		const ele = Number(/<ele>([^<]+)<\/ele>/.exec(m[2])?.[1] ?? NaN);
		if (Number.isFinite(lat) && Number.isFinite(lon))
			points.push({ lat, lon, ele });
	}
	if (points.length < 2)
		throw new GpxError(
			'This GPX has fewer than two track points. Export the track again, or pick another file.',
		);
	// A file with no elevation still rides — flat.
	if (points.every((p) => !Number.isFinite(p.ele)))
		points.forEach((p) => (p.ele = 0));
	else fillGaps(points);
	return { name, points };
}

function fillGaps(points: GpxPoint[]) {
	let last = points.find((p) => Number.isFinite(p.ele))?.ele ?? 0;
	for (const p of points) {
		if (Number.isFinite(p.ele)) last = p.ele;
		else p.ele = last;
	}
}
