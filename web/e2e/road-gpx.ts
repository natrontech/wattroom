/**
 * An invented road for the e2e rides, in the open South Atlantic (#3054):
 * three kilometres climbing 4 %, nobody's street.
 */
export function climbGpx(): string {
	const perLon = 111_195 * Math.cos((30 * Math.PI) / 180);
	const points = Array.from({ length: 301 }, (_, i) => {
		const lon = -25 + (i * 10) / perLon;
		return `<trkpt lat="-30.0000000" lon="${lon.toFixed(7)}"><ele>${(100 + 0.4 * i).toFixed(1)}</ele></trkpt>`;
	});
	return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="WattRoom e2e" xmlns="http://www.topografix.com/GPX/1/1">
<trk><name>A made-up climb</name><trkseg>
${points.join('\n')}
</trkseg></trk>
</gpx>`;
}
