import { beforeEach, describe, expect, it } from 'vitest';
import {
	createProfileStore,
	DEFAULT_PROFILE,
	parseProfile,
	PROFILE_LIMITS,
} from './profile.svelte';

/**
 * FTP scales every workout, so a bad stored value makes every session quietly
 * wrong rather than visibly broken. Anything out of range falls back rather than
 * being trusted.
 */
describe('parseProfile', () => {
	it('falls back for anything that is not a profile', () => {
		for (const value of [null, undefined, 42, 'ftp', []]) {
			expect(parseProfile(value)).toEqual(DEFAULT_PROFILE);
		}
	});

	it('keeps values inside the allowed range', () => {
		expect(parseProfile({ ftp: 265, kg: 74 })).toEqual({
			ftp: 265,
			kg: 74,
			ftpMeasuredAt: undefined,
			shareHr: true,
			sprintGrade: 5,
			singleSpeed: false,
		});
	});

	it('discards an out-of-range FTP rather than scaling every workout by it', () => {
		expect(parseProfile({ ftp: 5000, kg: 74 }).ftp).toBe(DEFAULT_PROFILE.ftp);
		expect(parseProfile({ ftp: 0, kg: 74 }).ftp).toBe(DEFAULT_PROFILE.ftp);
		expect(parseProfile({ ftp: PROFILE_LIMITS.maxFtp + 1, kg: 74 }).ftp).toBe(
			DEFAULT_PROFILE.ftp,
		);
	});

	it('discards nonsense weight independently of FTP', () => {
		const parsed = parseProfile({ ftp: 265, kg: -5 });
		expect(parsed.ftp).toBe(265);
		expect(parsed.kg).toBe(DEFAULT_PROFILE.kg);
	});

	it('rejects NaN, which sneaks through a naive typeof check', () => {
		expect(parseProfile({ ftp: NaN, kg: NaN })).toEqual(DEFAULT_PROFILE);
	});
});

// vitest runs in node; the store only needs get/set/remove, so a Map is the stub.
// ponytail: not jsdom — the whole web suite would slow down for three tests.
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

describe('update rejects rather than coerces', () => {
	beforeEach(() => stored.clear());

	/**
	 * The coercing path is right for stored junk and wrong for typed input: an FTP
	 * silently reset to the default is a wrong number the rider has no reason to doubt.
	 */
	it('refuses an out-of-range FTP with a message naming the range', () => {
		const store = createProfileStore();
		const before = store.current.ftp;
		expect(store.update({ ftp: 900 })).toMatch(/between 50 and 600/);
		expect(store.current.ftp).toBe(before);
	});

	it('refuses an out-of-range weight', () => {
		const store = createProfileStore();
		expect(store.update({ kg: 5 })).toMatch(/between 30 and 200/);
	});

	it('accepts a value inside the range', () => {
		const store = createProfileStore();
		expect(store.update({ ftp: 265 })).toBeNull();
		expect(store.current.ftp).toBe(265);
	});
});

describe('shareHr', () => {
	it('defaults to sharing — visible-in-room is the product promise', () => {
		expect(parseProfile({}).shareHr).toBe(true);
	});

	it('keeps a stored opt-out', () => {
		expect(parseProfile({ shareHr: false }).shareHr).toBe(false);
	});

	it('discards junk rather than guessing', () => {
		expect(parseProfile({ shareHr: 'no' }).shareHr).toBe(true);
	});
});
