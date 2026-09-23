import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(),
	leave: vi.fn(),
	pathname: '/',
	standing: false,
	current: null as { address: { crew: string } } | null,
}));
vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({
	page: {
		get url() {
			return new URL(`http://x${mocks.pathname}`);
		},
	},
}));
vi.mock('./connection.svelte', () => ({
	channelConnection: {
		get current() {
			return mocks.current;
		},
		onPlacePath: () => mocks.standing,
		// The real leave() drops the connection, address and all.
		leave: () => {
			mocks.leave();
			mocks.current = null;
		},
	},
}));

const { leaveChannel } = await import('./leave');

describe('leaveChannel', () => {
	beforeEach(() => {
		mocks.goto.mockReset();
		mocks.leave.mockReset();
		mocks.current = { address: { crew: 'c1' } };
	});

	it('lands on the crew the channel belongs to, not on You (#2560)', () => {
		mocks.pathname = '/crew/c1/v/ch1';
		mocks.standing = true;
		leaveChannel();
		expect(mocks.leave).toHaveBeenCalledOnce();
		expect(mocks.goto).toHaveBeenCalledWith('/crew/c1', {
			replaceState: true,
		});
	});

	it('stays put on a page that is not the channel’s own', () => {
		mocks.pathname = '/messages';
		mocks.standing = false;
		leaveChannel();
		expect(mocks.leave).toHaveBeenCalledOnce();
		expect(mocks.goto).not.toHaveBeenCalled();
	});
});
