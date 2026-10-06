import type {
	FullConfig,
	Reporter,
	Suite,
	TestRun,
} from '@playwright/test/reporter';

/**
 * Which shard, 1-based, runs a file: the files dealt out one at a time in
 * order, every project's copy of a file to the same shard.
 */
export function dealFiles(files: string[], total: number): Map<string, number> {
	const shards = new Map<string, number>();
	for (const file of files)
		if (!shards.has(file)) shards.set(file, (shards.size % total) + 1);
	return shards;
}

/**
 * `--shard` by file, round robin, in place of Playwright's contiguous slices
 * (#3859). The slow specs sit together alphabetically — ride-, road-, route- —
 * so a slice handed one runner nine minutes of riding and the next three.
 * Dealing a file's projects together keeps WebKit and Firefox, which run
 * world-place.spec.ts only, on one shard.
 */
export default class ShardByFile implements Reporter {
	async preprocess({
		config,
		suite,
		testRun,
	}: {
		config: FullConfig;
		suite: Suite;
		testRun: TestRun;
	}) {
		if (!config.shard) return;
		testRun.skipSharding();
		const { current, total } = config.shard;
		const files = suite.suites.flatMap((project) => project.suites);
		const shards = dealFiles(
			files.map((file) => file.title),
			total,
		);
		for (const file of files)
			if (shards.get(file.title) !== current) testRun.exclude(file);
	}

	printsToStdio() {
		return false;
	}
}
