import { expect, it } from 'vitest';
import { fieldDimmer } from '$lib/session/field-dim';

it('dims after 20 s unchanged and wakes on a change', () => {
	const d = fieldDimmer();
	d.see('cad', '90', 0);
	expect(d.dimmed('cad', 19_999)).toBe(false);
	expect(d.dimmed('cad', 20_000)).toBe(true);
	d.see('cad', '91', 25_000);
	expect(d.dimmed('cad', 25_000)).toBe(false);
});
