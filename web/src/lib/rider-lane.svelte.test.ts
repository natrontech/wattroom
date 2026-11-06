// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

let fetches = 0;
vi.mock('$lib/api', () => ({
	api: async () => {
		fetches += 1;
		return { ok: true, data: { crews: [] } };
	},
}));
// The lobby socket by hand: what the page sends, and frames the hub sends.
let socket: FakeSocket | null = null;
class FakeSocket {
	static OPEN = 1;
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;
	onclose: (() => void) | null = null;
	readyState = 0;
	sent: unknown[] = [];
	constructor() {
		socket = this;
	}
	open() {
		this.readyState = 1;
		this.onopen?.();
	}
	send(data: string) {
		this.sent.push(JSON.parse(data));
	}
	close() {
		this.readyState = 3;
	}
}
vi.stubGlobal('WebSocket', FakeSocket);

const { presence } = await import('$lib/presence.svelte');
const { riderLane } = await import('$lib/rider-lane.svelte');

describe('the rider’s lane on the lobby socket (#4425)', () => {
	afterEach(() => {
		presence.stop();
	});

	it('says what this screen rides on every open, and on a change only', () => {
		presence.start();
		socket!.open();
		expect(socket!.sent).toEqual([
			{ ride: { riding: false, tab: '', device: '' } },
		]);
		riderLane.claimRide(true, 'tab-1', 'desktop');
		riderLane.claimRide(true, 'tab-1', 'desktop');
		expect(socket!.sent).toHaveLength(2);

		// A reconnect is a fresh socket to the hub: the claim goes again.
		presence.stop();
		presence.start();
		socket!.open();
		expect(socket!.sent).toEqual([
			{ ride: { riding: true, tab: 'tab-1', device: 'desktop' } },
		]);
		riderLane.claimRide(false, 'tab-1', 'desktop');
	});

	it('takes the lane’s frames off the ping path, and pings still re-fetch', async () => {
		presence.start();
		socket!.open();
		await Promise.resolve();
		fetches = 0;

		socket!.onmessage?.({
			data: JSON.stringify({ ride: { device: 'desktop' } }),
		});
		socket!.onmessage?.({
			data: JSON.stringify({ gear: { label: '+1', atEnd: false } }),
		});
		expect(fetches).toBe(0);
		expect(riderLane.elsewhere).toBe('desktop');
		expect(riderLane.gear?.label).toBe('+1');

		socket!.onmessage?.({ data: JSON.stringify({}) });
		expect(fetches).toBe(1);

		// The ride ended: its answers go with it.
		socket!.onmessage?.({ data: JSON.stringify({ ride: { device: '' } }) });
		expect(riderLane.elsewhere).toBe('');
		expect(riderLane.gear).toBeNull();
	});

	it('hands a press from the phone to the riding screen', () => {
		presence.start();
		socket!.open();
		const heard: string[] = [];
		const off = riderLane.onRemote((cmd) => heard.push(cmd.action));
		socket!.onmessage?.({
			data: JSON.stringify({ remote: { action: 'view' } }),
		});
		off();
		socket!.onmessage?.({
			data: JSON.stringify({ remote: { action: 'page' } }),
		});
		expect(heard).toEqual(['view']);
	});
});
