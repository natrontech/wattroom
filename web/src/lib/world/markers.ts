// What the route itself says: where it starts, where it tops out, every
// kilometre, every hairpin, every village and every climb. Hairpins and
// climbs are $lib/road's, the one rule everything else reads (#3047).
import { hairpinsOf } from '$lib/road/climbs';
import { type Route } from '$lib/road/route';

export type Marker = {
	kind: 'start' | 'summit' | 'km' | 'hairpin' | 'village' | 'climb';
	d: number;
	label: string;
	to?: number;
};

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
	for (const d of hairpinsOf(route.road))
		markers.push({ kind: 'hairpin', d, label: '' });
	for (const c of route.climbs) {
		const len = c.topM - c.startM;
		markers.push({
			kind: 'climb',
			d: c.startM,
			to: c.topM,
			label: `${(len / 1000).toFixed(1)} km at ${((c.gainM / len) * 100).toFixed(1)} %`,
		});
	}
	return markers.sort((p, q) => p.d - q.d);
}
