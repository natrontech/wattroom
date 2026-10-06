// A plain unit test, not a Playwright spec (vite.config.ts splits them by
// suffix). A file the deal drops runs on no shard and nothing goes red, so
// the partition is pinned here, where the required `web` check sees it.
import { expect, it } from 'vitest';
import type { FullConfig, Suite, TestRun } from '@playwright/test/reporter';
import ShardByFile, { dealFiles } from './shard-by-file';

const FILES = ['a.spec.ts', 'b.spec.ts', 'c.spec.ts', 'd.spec.ts', 'e.spec.ts'];

/** What one shard keeps of a run with these projects, by "project › file". */
async function kept(
	projects: Record<string, string[]>,
	current: number,
	total: number,
): Promise<string[]> {
	const excluded = new Set<unknown>();
	let skipped = false;
	const suite = {
		suites: Object.entries(projects).map(([name, files]) => ({
			title: name,
			suites: files.map((title) => ({ title, project: name })),
		})),
	};
	await new ShardByFile().preprocess({
		config: { shard: { current, total } } as FullConfig,
		suite: suite as unknown as Suite,
		testRun: {
			skipSharding: () => (skipped = true),
			exclude: (file: unknown) => excluded.add(file),
		} as unknown as TestRun,
	});
	expect(skipped).toBe(true);
	return suite.suites.flatMap((p) =>
		p.suites
			.filter((f) => !excluded.has(f))
			.map((f) => `${p.title} › ${f.title}`),
	);
}

it('runs every file on exactly one shard, whatever the count', async () => {
	const projects = { chromium: FILES, webkit: ['c.spec.ts'] };
	const all = [...FILES.map((f) => `chromium › ${f}`), 'webkit › c.spec.ts'];
	for (let total = 1; total <= 7; total++) {
		const shards = [];
		for (let current = 1; current <= total; current++)
			shards.push(...(await kept(projects, current, total)));
		expect(shards.toSorted()).toEqual(all.toSorted());
	}
});

it('deals neighbours apart, and one file’s projects together', async () => {
	expect([...dealFiles(FILES, 3).values()]).toEqual([1, 2, 3, 1, 2]);
	expect(await kept({ chromium: FILES, webkit: ['b.spec.ts'] }, 2, 3)).toEqual([
		'chromium › b.spec.ts',
		'chromium › e.spec.ts',
		'webkit › b.spec.ts',
	]);
});

it('leaves an unsharded run alone', async () => {
	const testRun = {
		skipSharding: () => {
			throw new Error('sharded an unsharded run');
		},
		exclude: () => {
			throw new Error('excluded from an unsharded run');
		},
	};
	await new ShardByFile().preprocess({
		config: { shard: null } as FullConfig,
		suite: { suites: [] } as unknown as Suite,
		testRun: testRun as unknown as TestRun,
	});
});
