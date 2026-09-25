import { beforeEach, describe, expect, it } from 'vitest';
import {
	createHistoryStore,
	forgetHistoryOf,
	summarise,
	type RideRecord,
} from './history.svelte';

describe('summarise', () => {
	it('is zeroed for a ride with no samples', () => {
		expect(summarise([])).toEqual({ seconds: 0, kj: 0, avgWatts: 0 });
	});

	it('counts one second per sample and rounds work to whole kJ', () => {
		// 120 samples at 200 W = 24 000 J = 24 kJ.
		expect(summarise(Array(120).fill({ watts: 200 }))).toEqual({
			seconds: 120,
			kj: 24,
			avgWatts: 200,
		});
	});

	it('rounds the average rather than truncating, matching what importers compute', () => {
		expect(summarise([{ watts: 200 }, { watts: 201 }]).avgWatts).toBe(201);
	});
});

// vitest runs in node; the store only needs get/set/remove.
const stored = new Map<string, string>();
globalThis.localStorage = {
	getItem: (k: string) => stored.get(k) ?? null,
	setItem: (k: string, v: string) => void stored.set(k, v),
	removeItem: (k: string) => void stored.delete(k),
	clear: () => stored.clear(),
	key: (i: number) => [...stored.keys()][i] ?? null,
	get length() {
		return stored.size;
	},
} as Storage;

const summary = (id: string): RideRecord => ({
	id,
	workoutName: 'Openers',
	startedAt: `2026-09-2${id}T07:00:00.000Z`,
	seconds: 40,
	kj: 8,
	avgWatts: 200,
	execution: 0,
	ftp: 250,
});

// One laptop, two riders (#2805): the summaries only this device holds are
// each rider's own, the way the ride buffer's rides are.
describe('device history on a browser two riders share', () => {
	const ANA = 'rider-ana';
	const BEN = 'rider-ben';
	let who = ANA;
	const store = () => createHistoryStore(() => who);

	beforeEach(() => {
		stored.clear();
		who = ANA;
	});

	it("lists only the signed-in rider's summaries", () => {
		store().add(summary('1'));
		who = BEN;
		expect(store().all).toEqual([]);
		who = ANA;
		expect(store().all.map((r) => r.id)).toEqual(['1']);
	});

	it('follows the account while the page stays open', () => {
		const history = store();
		history.add(summary('1'));
		who = BEN;
		expect(history.all).toEqual([]);
	});

	it("clears the rider's own list and leaves the other's", () => {
		store().add(summary('1'));
		who = BEN;
		store().add(summary('2'));
		store().clear();
		who = ANA;
		expect(store().all.map((r) => r.id)).toEqual(['1']);
	});

	it('lists a summary kept before owners to whoever is here', () => {
		stored.set('wattroom.history.v1', JSON.stringify([summary('1')]));
		who = BEN;
		expect(store().all.map((r) => r.id)).toEqual(['1']);
	});

	it("forgets a deleted account's summaries and nobody else's", () => {
		stored.set('wattroom.history.v1', JSON.stringify([summary('3')]));
		store().add(summary('1'));
		who = BEN;
		store().add(summary('2'));
		forgetHistoryOf(ANA);
		expect(store().all.map((r) => r.id)).toEqual(['3', '2']);
		who = ANA;
		expect(store().all.map((r) => r.id)).toEqual(['3']);
	});
});
