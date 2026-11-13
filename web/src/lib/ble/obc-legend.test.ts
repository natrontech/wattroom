import { describe, expect, it } from 'vitest';
import { WATTROOM_APP_INFO } from './obc';
import { OBC_NAMES } from './obc-legend';

/** The IDs App Information tells a controller WattRoom answers. */
const advertised = [...WATTROOM_APP_INFO.slice(13)];

describe('the Controllers page’s button legend (#4547)', () => {
	it('names every ID WattRoom advertises', () => {
		for (const id of advertised) expect(OBC_NAMES[id]?.action).toBeTruthy();
	});
});
