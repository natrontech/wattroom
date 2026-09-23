import { describe, expect, it } from 'vitest';
import { updateRowState } from './update-row';

const none = {
	installing: false,
	downloaded: null,
	manual: null,
	live: null,
	unseen: null,
};
const unseen = { version: '2026.09.132', changes: 2 };

describe('updateRowState (#2588)', () => {
	it('says nothing when there is nothing', () => {
		expect(updateRowState(none)).toBeNull();
	});

	it('says one thing, the most urgent first', () => {
		const all = {
			installing: true,
			downloaded: '2026.9.6',
			manual: '2026.9.6',
			live: '2026.09.133',
			unseen,
		};
		expect(updateRowState(all)).toEqual({ kind: 'installing' });
		expect(updateRowState({ ...all, installing: false })).toEqual({
			kind: 'desktop',
			version: '2026.9.6',
		});
		expect(
			updateRowState({ ...all, installing: false, downloaded: null }),
		).toEqual({ kind: 'manual', version: '2026.9.6' });
		// A newer WattRoom beats its own release notes: reload first, and the
		// notes that arrive with it are the ones worth reading.
		expect(updateRowState({ ...none, live: '2026.09.133', unseen })).toEqual({
			kind: 'live',
			version: '2026.09.133',
		});
		expect(updateRowState({ ...none, unseen })).toEqual({
			kind: 'release',
			version: '2026.09.132',
			changes: 2,
		});
	});
});
