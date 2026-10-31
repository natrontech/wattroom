/** A stable 0–1 from three numbers, for what every screen must draw or play alike. */
export function hash3(a: number, b: number, c: number): number {
	const h = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
	return h - Math.floor(h);
}
