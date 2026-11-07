import { describe, expect, it } from 'vitest';
import { ArcadeBergpreis, ArcadeDarts, ArcadeFeedZone } from '$lib/protocol';
import { GAMES } from './index';
import {
	type Run as FeedRun,
	FEED_ZONE,
	POINTS,
	REACH_SEC,
	newRun as feedRun,
	step as feedStep,
} from './feedzone';
import {
	CX,
	CY,
	DARTS,
	aimOf,
	newRun as dartsRun,
	pointsAt,
	step as dartsStep,
} from './darts';

const DT = 1 / 60;

describe('the cabinet', () => {
	it('plays every game the server keeps a board for', () => {
		expect(GAMES.map((g) => g.id).sort()).toEqual(
			[ArcadeBergpreis, ArcadeDarts, ArcadeFeedZone].sort(),
		);
	});

	it('plays the same run again on the same seed', () => {
		for (const game of GAMES) {
			const run = () => {
				let s = game.start(20399);
				for (let i = 0; !game.over(s) && i < 60 * 60; i++)
					s = game.step(s, DT, i % 40 < 12);
				return game.score(s);
			};
			expect(run()).toBe(run());
		}
	});

	it('ends every game, even untouched', () => {
		for (const game of GAMES) {
			let s = game.start(7);
			let i = 0;
			for (; !game.over(s) && i < 60 * 120; i++) s = game.step(s, DT, false);
			expect(game.over(s), game.id).toBe(true);
		}
	});
});

describe('Feed zone', () => {
	/** A rider who taps just as each soigneur's hand comes by, and leaves the flags. */
	function perfect(seed: number) {
		let r = feedRun(seed);
		let down = 0;
		while (!FEED_ZONE.over(r)) {
			const next = r.stands.find((s) => !s.done && s.at >= r.metres - 0.2);
			const due =
				next &&
				next.holds !== 'flag' &&
				next.at - r.metres < 0.25 &&
				r.reach === 0;
			if (due && down === 0) down = 2;
			r = feedStep(r, DT, down > 0);
			if (down > 0) down--;
		}
		return r;
	}

	it('pays a clean streak far more than mashing the button', () => {
		const good = perfect(3);
		let mash = feedRun(3);
		for (let i = 0; !FEED_ZONE.over(mash); i++)
			mash = feedStep(mash, DT, i % 20 < 10);
		expect(good.points).toBeGreaterThan(mash.points * 2);
		expect(good.best).toBeGreaterThan(5);
	});

	it('stays on the machine however well you play', () => {
		for (const seed of [1, 2, 3, 20399, 20400])
			expect(perfect(seed).points).toBeLessThan(FEED_ZONE.most);
	});

	it('breaks the streak on a grab at thin air', () => {
		let r = { ...feedRun(1), streak: 4 };
		r = feedStep(r, DT, true);
		for (let t = 0; t < REACH_SEC + 0.1; t += DT)
			r = feedStep({ ...r, stands: [] }, DT, false);
		expect(r.streak).toBe(0);
	});

	it('counts a grab within reach', () => {
		let r: FeedRun = { ...feedRun(1), stands: [{ at: 0.5, holds: 'bidon' }] };
		r = feedStep(r, DT, true);
		r = feedStep(r, DT, false);
		expect(r.points).toBe(POINTS.bidon);
		expect(r.stands[0].done).toBe('got');
	});

	it('loses the streak to a fan’s flag', () => {
		let r: FeedRun = {
			...feedRun(1),
			streak: 5,
			stands: [{ at: 0.5, holds: 'flag' }],
		};
		r = feedStep(r, DT, true);
		expect(r.streak).toBe(0);
		expect(r.points).toBe(0);
	});
});

describe('Darts', () => {
	it('scores the board as darts does', () => {
		expect(pointsAt(CX, CY)).toBe(50);
		expect(pointsAt(CX + 3, CY)).toBe(25);
		expect(pointsAt(CX, CY - 10)).toBe(20);
		expect(pointsAt(CX, CY - 19)).toBe(60);
		expect(pointsAt(CX, CY - 32)).toBe(40);
		expect(pointsAt(CX, CY + 10)).toBe(3);
		expect(pointsAt(CX + 10, CY)).toBe(6);
		expect(pointsAt(CX, CY - 40)).toBe(0);
	});

	it('steadies the aim while held, then shakes', () => {
		const sway = (holding: number) => {
			let most = 0;
			for (let t = 0; t < 6; t += 0.05) {
				const a = aimOf({ ...dartsRun(5), t, holding });
				most = Math.max(most, Math.hypot(a.x - CX, a.y - CY));
			}
			return most;
		};
		expect(sway(1)).toBeLessThan(sway(0) / 2);
		expect(sway(3.5)).toBeGreaterThan(sway(1));
	});

	it('throws three darts, one per release', () => {
		let r = dartsRun(9);
		for (let n = 0; n < DARTS; n++) {
			for (let i = 0; i < 50; i++) r = dartsStep(r, DT, true);
			r = dartsStep(r, DT, false);
			expect(r.darts).toHaveLength(n + 1);
			for (let i = 0; i < 60; i++) r = dartsStep(r, DT, false);
		}
		expect(r.darts.every((d) => d.points >= 0 && d.points <= 60)).toBe(true);
	});
});
