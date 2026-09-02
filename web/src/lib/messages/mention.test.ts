import { describe, expect, it } from 'vitest';
import { mentionsMe } from './mention';

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
