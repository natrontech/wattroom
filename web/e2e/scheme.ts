import type { Locator } from '@playwright/test';

/** The frame while a ride runs: page and sidebar (#4160). */
export const RIDE_FRAME = '[data-ride]:has(#page-body)';

/**
 * `el` paints in the rider's own scheme, the one the document root resolves:
 * a ride forces none (Jan, 2026-10-25, #4160), where the cave forced dark.
 */
export function inRidersScheme(el: Locator): Promise<boolean> {
	return el.evaluate(
		(node) =>
			getComputedStyle(node).colorScheme ===
			getComputedStyle(document.documentElement).colorScheme,
	);
}
