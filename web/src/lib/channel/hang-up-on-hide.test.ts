import { beforeEach, describe, expect, it, vi } from 'vitest';

const av = { status: 'live' as string, leave: vi.fn() };
const connection = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('./connection.svelte', () => ({ channelConnection: connection }));

import { hangUpOnHide } from './hang-up-on-hide';

describe('a closed desktop window hangs up (#3005)', () => {
	beforeEach(() => {
		av.status = 'live';
		av.leave.mockClear();
		connection.current = { av };
	});

	it('leaves voice when the window hides', () => {
		hangUpOnHide(false);
		expect(av.leave).toHaveBeenCalledTimes(1);
	});

	it('does nothing when the window shows', () => {
		hangUpOnHide(true);
		expect(av.leave).not.toHaveBeenCalled();
	});

	it('does nothing outside a call, or outside a channel', () => {
		av.status = 'off';
		hangUpOnHide(false);
		connection.current = null;
		hangUpOnHide(false);
		expect(av.leave).not.toHaveBeenCalled();
	});
});
