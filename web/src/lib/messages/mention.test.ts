import { describe, expect, it } from 'vitest';
import { completeMention, mentionCompletion, mentionsMe } from './mention';

describe('mentionsMe', () => {
	it('matches @first-name and @full-name, case-insensitively', () => {
		expect(mentionsMe('me, 19:30. @Jan you in?', 'Jan Lauber')).toBe(true);
		expect(mentionsMe('@jan?', 'Jan Lauber')).toBe(true);
		expect(mentionsMe('cc @Jan Lauber', 'Jan Lauber')).toBe(true);
	});

	it('does not fire for someone whose name merely starts with mine', () => {
		expect(mentionsMe('@Janine you in?', 'Jan Lauber')).toBe(false);
		expect(mentionsMe('mail jan@example.com', 'Jan Lauber')).toBe(false);
		expect(mentionsMe('plain jan', 'Jan Lauber')).toBe(false);
	});

	it('is quiet without a name to match', () => {
		expect(mentionsMe('@Jan', undefined)).toBe(false);
		expect(mentionsMe('@Jan', '   ')).toBe(false);
	});
});

describe('mentionCompletion (#1766)', () => {
	const names = ['Jan Lauber', 'Janine', 'David'];
	it('offers the names the typed prefix could mean, case aside', () => {
		expect(mentionCompletion('hey @ja', names)).toEqual({
			at: 4,
			hits: ['Jan Lauber', 'Janine'],
		});
		expect(mentionCompletion('@', names)?.hits).toEqual(names);
	});
	it('offers nothing off an @ inside a word, or once the name is typed', () => {
		expect(mentionCompletion('mail@ja', names)).toBeNull();
		expect(mentionCompletion('hey @janine', names)).toBeNull();
		expect(mentionCompletion('hey @Jan Lauber ', names)).toBeNull();
	});
	it('completes in place and leaves the cursor after a space', () => {
		expect(completeMention('hey @ja', 4, 'Jan Lauber')).toBe(
			'hey @Jan Lauber ',
		);
	});
});
