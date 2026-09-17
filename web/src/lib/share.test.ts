// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shareLink, shareVerb } from '$lib/share';

const env = vi.hoisted(() => ({ coarse: false }));
vi.mock('$lib/device.svelte', () => ({
	device: {
		get coarse() {
			return env.coarse;
		},
	},
}));

const shown = vi.hoisted(() => ({
	said: [] as { text: string; tone?: string }[],
}));
vi.mock('$lib/toast.svelte', () => ({
	toasts: {
		push: (text: string, opts?: { tone?: string }) =>
			shown.said.push({ text, tone: opts?.tone }),
	},
}));

const wrote: string[] = [];
const sheet = { opened: [] as string[], answer: async () => {} };

function define(key: 'share' | 'clipboard', value: unknown) {
	Object.defineProperty(navigator, key, { value, configurable: true });
}

/** A device with a Web Share API, whichever pointer `env` says it has. */
function withShareSheet() {
	define('share', async (data: ShareData) => {
		sheet.opened.push(data.url ?? '');
		await sheet.answer();
	});
}

const LINK = 'https://wattroom.test/c/AB12CD';

beforeEach(() => {
	shown.said = [];
	wrote.length = 0;
	sheet.opened = [];
	sheet.answer = async () => {};
	env.coarse = false;
	define('clipboard', {
		writeText: async (text: string) => {
			wrote.push(text);
		},
	});
	define('share', undefined);
});

describe('shareLink (#973)', () => {
	it('opens the share sheet on a finger, and says nothing over it', async () => {
		env.coarse = true;
		withShareSheet();
		await shareLink(LINK, 'Invite link copied.');
		expect(sheet.opened).toEqual([LINK]);
		// The sheet is the feedback. A toast under it would say "copied" about
		// a copy that did not happen.
		expect(wrote).toEqual([]);
		expect(shown.said).toEqual([]);
	});

	it('leaves a mouse the clipboard it is reaching for', async () => {
		// The API exists on desktop Chrome; an OS share dialog is not what a
		// rider pasting into the next window wants.
		withShareSheet();
		await shareLink(LINK, 'Invite link copied.');
		expect(sheet.opened).toEqual([]);
		expect(wrote).toEqual([LINK]);
		expect(shown.said).toEqual([
			{ text: 'Invite link copied.', tone: undefined },
		]);
	});

	it('says nothing when the rider closes the sheet', async () => {
		// Nothing was lost, so nothing is claimed — and in particular the link
		// is not copied behind their back under a toast saying so.
		env.coarse = true;
		withShareSheet();
		sheet.answer = () => Promise.reject(new DOMException('', 'AbortError'));
		await shareLink(LINK, 'Invite link copied.');
		expect(wrote).toEqual([]);
		expect(shown.said).toEqual([]);
	});

	it('falls back to the clipboard when the sheet refuses', async () => {
		// No transient activation left, a shell that declares share and cannot
		// perform one: the link went nowhere, and silence there is discovered
		// at the paste (errors.md).
		env.coarse = true;
		withShareSheet();
		sheet.answer = () =>
			Promise.reject(new DOMException('', 'NotAllowedError'));
		await shareLink(LINK, 'Invite link copied.');
		expect(wrote).toEqual([LINK]);
		expect(shown.said).toEqual([
			{ text: 'Invite link copied.', tone: undefined },
		]);
	});

	it('hands the link over when neither sheet nor clipboard works', async () => {
		env.coarse = true;
		withShareSheet();
		sheet.answer = () =>
			Promise.reject(new DOMException('', 'NotAllowedError'));
		define('clipboard', {
			writeText: () => Promise.reject(new Error('NotAllowedError')),
		});
		await shareLink(LINK, 'Invite link copied.');
		expect(shown.said).toEqual([
			{ text: `Could not copy — the link is ${LINK}`, tone: 'error' },
		]);
	});
});

describe('shareVerb', () => {
	it('says Share only where the sheet will open', () => {
		env.coarse = true;
		withShareSheet();
		expect(shareVerb()).toBe('Share');
	});

	it('says Copy on a mouse, and where there is no sheet at all', () => {
		withShareSheet();
		expect(shareVerb()).toBe('Copy');
		env.coarse = true;
		define('share', undefined);
		expect(shareVerb()).toBe('Copy');
	});
});
