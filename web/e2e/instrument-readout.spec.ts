import { expect, test } from '@playwright/test';
import { signInTo } from './signin';

/**
 * The big number stays inside its own box (#2888, L8-11). The box was a fixed
 * 112 px holding about 118 px — the numeral, "watts" and the zone line — and,
 * anchored at its foot, spilled upward into whatever sat above: on a phone,
 * the "watching …" label that says whose number it is.
 */
test('the readout does not spill out of its box', async ({ page }) => {
	await signInTo(page, '/ride?w=smoke-test');
	await page.getByRole('button', { name: 'Ride simulated' }).click();
	await expect(
		page.getByText('Simulated Trainer').locator('..').getByText(/\d+ W/),
	).toBeVisible({ timeout: 15_000 });
	await page.getByRole('button', { name: 'Start the ride' }).click();
	const box = page.getByTestId('instrument-readout').first();
	// Pedalling, so all three lines are there: number, "watts", the zone.
	await expect(box.getByText(/^z\d/i)).toBeVisible({ timeout: 15_000 });
	const spill = await box.evaluate((el) => {
		const top = el.getBoundingClientRect().top;
		const highest = Math.min(
			...[...el.querySelectorAll('*')].map(
				(c) => c.getBoundingClientRect().top,
			),
		);
		return top - highest;
	});
	expect(spill, 'px of the readout above its own box').toBeLessThanOrEqual(0);
});

/**
 * Four digits keep one width and stay inside the box (#3869). Chakra Petch has
 * no tabular figures, so 1098 drew 24 px wider than 1100; and the glide's clamp
 * held the centre 5rem from the edge, past which a four-digit figure ran.
 */
test('four digits keep one width, inside the box', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await signInTo(page, '/ride');
	// Landed: the sign-in's bounce back to /ride would otherwise overtake the POST.
	await page.getByRole('button', { name: 'Ride simulated' }).waitFor();
	const id = await page.evaluate(async () => {
		const res = await fetch('/api/workouts', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				workout: {
					name: 'Four digits',
					steps: [{ type: 'steady', seconds: 600, watts: 1100 }],
				},
			}),
		});
		return ((await res.json()) as { id: string }).id;
	});
	try {
		await page.goto(`/ride?w=${id}`);
		await page.getByRole('button', { name: 'Ride simulated' }).click();
		await page.getByRole('button', { name: 'Start the ride' }).click();
		const box = page.getByTestId('instrument-readout').first();
		// The readout is as wide as its widest line, at four digits the number.
		const seen = new Map<string, { width: number; inside: boolean }>();
		await expect
			.poll(
				async () => {
					const read = await box.evaluate((el) => {
						const outer = el.getBoundingClientRect();
						const readout = el.firstElementChild!.getBoundingClientRect();
						return {
							watts: el.firstElementChild!.firstElementChild!.textContent!,
							width: readout.width,
							inside:
								readout.left >= outer.left - 0.5 &&
								readout.right <= outer.right + 0.5,
						};
					});
					if (/^\d{4}$/.test(read.watts)) seen.set(read.watts, read);
					return seen.size;
				},
				{ timeout: 90_000, intervals: [500] },
			)
			.toBeGreaterThanOrEqual(2);
		const reads = [...seen.entries()];
		for (const [watts, { inside }] of reads)
			expect(inside, `${watts} W inside the box`).toBe(true);
		const widths = reads.map(([, { width }]) => width);
		expect(
			Math.max(...widths) - Math.min(...widths),
			JSON.stringify(reads),
		).toBeLessThan(0.5);
	} finally {
		await page.evaluate(
			(workoutId) => fetch(`/api/workouts/${workoutId}`, { method: 'DELETE' }),
			id,
		);
	}
});
