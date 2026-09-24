import { describe, expect, it } from 'vitest';
import { deleteChannelWarning } from './channels';

describe('deleteChannelWarning', () => {
	// The server cancels a private voice channel's plans with it (#2610); the
	// confirm is the only place an admin learns that before it happens.
	it('says a private voice channel takes its plans', () => {
		expect(deleteChannelWarning({ kind: 'voice', private: true })).toContain(
			'is cancelled',
		);
	});
	it('says an open voice channel leaves its plans on the schedule', () => {
		const said = deleteChannelWarning({ kind: 'voice', private: false });
		expect(said).toContain('stays on the crew’s schedule');
		expect(said).not.toContain('cancelled');
	});
	it('names a text channel’s messages, not plans', () => {
		expect(deleteChannelWarning({ kind: 'text', private: true })).not.toContain(
			'planned',
		);
	});
});
