// What the route itself says: where it starts, where it tops out, every
// kilometre, every hairpin, every village and every climb worth a name.
import { type Route } from '$lib/road/route';
import { wrapAngle } from '$lib/road/along';

export type Marker = {
	kind: 'start' | 'summit' | 'km' | 'hairpin' | 'village' | 'climb';
	d: number;
	label: string;
	to?: number;
};

const HAIRPIN_TURN = 2.2; // radians of heading change across ±60 m
const CLIMB_WINDOW = 500; // metres the average grade is taken over
const CLIMB_GRADE = 4; // percent
const CLIMB_MIN = 1500; // metres

export function markersFor(
	route: Route,
	villages: { d: number; name: string }[],
): Marker[] {
	const markers: Marker[] = [
		{ kind: 'start', d: 0, label: route.loop ? 'Start / Finish' : 'Start' },
	];
	let top = 0;
	for (let i = 1; i < route.ele.length; i++)
		if (route.ele[i] > route.ele[top]) top = i;
	markers.push({
		kind: 'summit',
		d: top * route.step,
		label: `${Math.round(route.ele[top])} m`,
	});
	for (let km = 1000; km < route.length - 200; km += 1000)
		markers.push({ kind: 'km', d: km, label: `${km / 1000}` });
	for (const v of villages)
		markers.push({ kind: 'village', d: v.d, label: v.name });
	const H = Math.round(60 / route.step);
	let lastPin = -Infinity;
	for (let i = H; i < route.x.length - H - 1; i++) {
		const a = Math.atan2(
			route.x[i] - route.x[i - H],
			route.z[i] - route.z[i - H],
		);
		const b = Math.atan2(
			route.x[i + H] - route.x[i],
			route.z[i + H] - route.z[i],
		);
		const turn = Math.abs(wrapAngle(b - a));
		if (turn > HAIRPIN_TURN && i * route.step - lastPin > 200) {
			lastPin = i * route.step;
			markers.push({ kind: 'hairpin', d: i * route.step, label: '' });
		}
	}
	// Climbs: 500 m average above 4 % for at least 1.5 km — the KOMs of the route.
	const W = Math.round(CLIMB_WINDOW / route.step);
	let start = -1;
	for (let i = 0; i + W < route.ele.length; i++) {
		const g = ((route.ele[i + W] - route.ele[i]) / (W * route.step)) * 100;
		if (g > CLIMB_GRADE && start < 0) start = i;
		if ((g <= CLIMB_GRADE || i + W + 1 >= route.ele.length) && start >= 0) {
			const end = i + W;
			const len = (end - start) * route.step;
			const gain = route.ele[end] - route.ele[start];
			if (len >= CLIMB_MIN)
				markers.push({
					kind: 'climb',
					d: start * route.step,
					to: end * route.step,
					label: `${(len / 1000).toFixed(1)} km at ${((gain / len) * 100).toFixed(1)} %`,
				});
			start = -1;
		}
	}
	return markers.sort((p, q) => p.d - q.d);
}
