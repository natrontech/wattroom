import { describe, expect, it } from 'vitest';
import { REJOIN_WINDOW_MS, type VoiceNotes, shouldRejoinVoice } from './rejoin';

const NOW = 1_700_000_000_000;
const mine = 'tab-a';
const other = 'tab-b';

/** Everything true, so each test can spoil exactly one thing. */
function ask(over: Partial<Parameters<typeof shouldRejoinVoice>[0]> = {}) {
	const notes: VoiceNotes = {
		[mine]: { slug: 'mfw', at: NOW - 5_000, mic: true },
	};
	return shouldRejoinVoice({
		notes,
		tab: mine,
		slug: 'mfw',
		avEnabled: true,
		now: NOW,
		...over,
	});
}

describe('shouldRejoinVoice (#480)', () => {
	it('walks back into the room it was in, mic and all', () => {
		expect(ask()).toEqual({ mic: true });
	});

	it('comes back muted for a rider who was muted', () => {
		// The one thing this must never do is open a mic on someone's behalf.
		expect(
			ask({ notes: { [mine]: { slug: 'mfw', at: NOW - 5_000, mic: false } } }),
		).toEqual({ mic: false });
	});

	it('stays out once the note is older than the window', () => {
		// A reload takes seconds; coming back after lunch is not a reload.
		expect(
			ask({
				notes: {
					[mine]: { slug: 'mfw', at: NOW - REJOIN_WINDOW_MS - 1, mic: true },
				},
			}),
		).toBe(null);
	});

	it('still counts a note restamped just inside the window', () => {
		expect(
			ask({
				notes: {
					[mine]: { slug: 'mfw', at: NOW - REJOIN_WINDOW_MS, mic: true },
				},
			}),
		).toEqual({ mic: true });
	});

	it('stays out in a different room', () => {
		// Opening someone else's room fresh is not a refresh of yours.
		expect(ask({ slug: 'thursday-threshold' })).toBe(null);
	});

	it('stays out after an explicit leave', () => {
		// av.leave() deletes this tab's note; nothing else is left to act on.
		expect(ask({ notes: {} })).toBe(null);
	});

	it('stays out when the account has no AV', () => {
		expect(ask({ avEnabled: false })).toBe(null);
	});

	it('yields to another tab of yours holding the mic (#293)', () => {
		expect(
			ask({
				notes: {
					[mine]: { slug: 'mfw', at: NOW - 5_000, mic: true },
					[other]: { slug: 'mfw', at: NOW - 1_000, mic: true },
				},
			}),
		).toBe(null);
	});

	it('yields even when that tab is in another room', () => {
		// There is one microphone on the machine, and it is in use.
		expect(
			ask({
				notes: {
					[mine]: { slug: 'mfw', at: NOW - 5_000, mic: true },
					[other]: { slug: 'sunday-spin', at: NOW - 1_000, mic: true },
				},
			}),
		).toBe(null);
	});

	it('ignores a tab that is only listening', () => {
		expect(
			ask({
				notes: {
					[mine]: { slug: 'mfw', at: NOW - 5_000, mic: true },
					[other]: { slug: 'mfw', at: NOW - 1_000, mic: false },
				},
			}),
		).toEqual({ mic: true });
	});

	it('ignores a crashed tab whose note has gone stale', () => {
		expect(
			ask({
				notes: {
					[mine]: { slug: 'mfw', at: NOW - 5_000, mic: true },
					[other]: {
						slug: 'mfw',
						at: NOW - REJOIN_WINDOW_MS - 1,
						mic: true,
					},
				},
			}),
		).toEqual({ mic: true });
	});

	it('stays out, and does not throw, on a missing or corrupt store', () => {
		// Cleared storage, a hand-edited key, a record from a version that
		// never existed: a rider just does not rejoin.
		expect(ask({ notes: null })).toBe(null);
		expect(ask({ notes: undefined })).toBe(null);
		expect(ask({ notes: 'nonsense' as unknown as VoiceNotes })).toBe(null);
		expect(
			ask({ notes: { [mine]: null as unknown as VoiceNotes[string] } }),
		).toBe(null);
		expect(
			ask({
				notes: { [mine]: { slug: 'mfw' } as unknown as VoiceNotes[string] },
			}),
		).toBe(null);
		expect(
			ask({
				notes: {
					[mine]: { slug: 'mfw', at: NOW - 5_000, mic: true },
					[other]: 7 as unknown as VoiceNotes[string],
				},
			}),
		).toEqual({ mic: true });
	});

	it('does not read a stamp from the future as a refresh', () => {
		// The clock moved under us; that is not evidence of anything.
		expect(
			ask({ notes: { [mine]: { slug: 'mfw', at: NOW + 5_000, mic: true } } }),
		).toBe(null);
	});
});
