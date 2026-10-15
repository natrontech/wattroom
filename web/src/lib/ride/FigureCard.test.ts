import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// Target item 6 of ride-figure-card: the preview is a still, so reduced motion
// has nothing to hold.
it('the figure card animates nothing', () => {
	const src = readFileSync(
		new URL('./FigureCard.svelte', import.meta.url),
		'utf8',
	);
	expect(src).not.toMatch(/transition|animate|animation|@keyframes|transform:/);
});
