import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MenuItem } from '$lib/context-menu.svelte';
import type { LiveChannel, LiveOccupant } from '$lib/crews-live';
import { ARRIVAL_MS } from './voice-move';

const { api, push } = vi.hoisted(() => ({ api: vi.fn(), push: vi.fn() }));
vi.mock('$lib/api', () => ({ api }));
vi.mock('$lib/toast.svelte', () => ({ toasts: { push } }));
const { createVoiceMover } = await import('./voice-mover.svelte');

const kim: LiveOccupant = { id: 'kim', name: 'Kim' };
const channel = (id: string, ...occupants: LiveOccupant[]): LiveChannel => ({
	id,
	kind: 'voice',
	name: id[0].toUpperCase() + id.slice(1),
	occupants,
});
let voices = $state<LiveChannel[]>([]);
const mover = () =>
	createVoiceMover({ admin: () => true, voices: () => voices });
const names = (m: ReturnType<typeof mover>, id: string) =>
	m.occupants(voices.find((v) => v.id === id)!).map((o) => o.name);
const moveKim = (m: ReturnType<typeof mover>, to: string) =>
	(m.menu(voices[0], kim) as MenuItem[]).find(
		(e) => e.label === `Move to ${to}`,
	)!;

// What an admin sees between the drop and the rider arriving (#2745).
describe('a move in the air', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		api.mockReset();
		push.mockReset();
		voices = [channel('cave', kim), channel('lair')];
	});
	afterEach(() => vi.useRealTimers());

	it('lands on drop and stays once the rider arrives, with nothing said', async () => {
		api.mockResolvedValue({ ok: true });
		const m = mover();
		moveKim(m, 'Lair').onSelect();
		expect(names(m, 'lair')).toEqual(['Kim']);
		expect(names(m, 'cave')).toEqual([]);
		expect(m.inFlight('kim')).toBe(true);
		await vi.advanceTimersByTimeAsync(0);

		voices = [channel('cave'), channel('lair', kim)];
		expect(m.inFlight('kim')).toBe(false);
		await vi.advanceTimersByTimeAsync(ARRIVAL_MS);
		expect(names(m, 'lair')).toEqual(['Kim']);
		expect(push).not.toHaveBeenCalled();
	});

	it('goes back with the server’s reason when the move is refused', async () => {
		api.mockResolvedValue({
			ok: false,
			error: { message: 'They are riding, and a move would end their ride.' },
		});
		const m = mover();
		moveKim(m, 'Lair').onSelect();
		expect(names(m, 'lair')).toEqual(['Kim']);
		await vi.advanceTimersByTimeAsync(0);
		expect(names(m, 'cave')).toEqual(['Kim']);
		expect(names(m, 'lair')).toEqual([]);
		expect(push).toHaveBeenCalledWith(
			'They are riding, and a move would end their ride.',
			{ tone: 'error' },
		);
	});

	it('goes back, and says so, when the rider never arrives', async () => {
		api.mockResolvedValue({ ok: true });
		const m = mover();
		moveKim(m, 'Lair').onSelect();
		await vi.advanceTimersByTimeAsync(ARRIVAL_MS - 1);
		expect(names(m, 'lair')).toEqual(['Kim']);
		expect(push).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(names(m, 'cave')).toEqual(['Kim']);
		expect(names(m, 'lair')).toEqual([]);
		expect(push).toHaveBeenCalledWith(
			expect.stringContaining('Kim hasn’t arrived in Lair'),
			{ tone: 'error' },
		);
	});

	it('will not send a rider twice while the first move is in the air', async () => {
		api.mockResolvedValue({ ok: true });
		voices = [channel('cave', kim), channel('lair'), channel('den')];
		const m = mover();
		moveKim(m, 'Lair').onSelect();
		const again = m.menu(voices[0], kim) as MenuItem[];
		expect(again.map((e) => e.label)).toEqual(['Move to Cave', 'Move to Den']);
		expect(again.every((e) => e.disabled && e.hint === 'moving')).toBe(true);
		expect(m.grab(voices[1], kim)).not.toHaveProperty('draggable');
		expect(api).toHaveBeenCalledTimes(1);
	});

	it('offers nothing to a member, and never a rider who is pedalling', () => {
		const member = createVoiceMover({
			admin: () => false,
			voices: () => voices,
		});
		expect(member.menu(voices[0], kim)).toEqual([]);
		expect(member.grab(voices[0], kim)).toEqual({});
		const riding = { ...kim, riding: true };
		const m = mover();
		expect(m.grab(voices[0], riding)).not.toHaveProperty('draggable');
		expect((m.menu(voices[0], riding) as MenuItem[])[0]).toMatchObject({
			disabled: true,
			hint: 'riding',
		});
	});
});
