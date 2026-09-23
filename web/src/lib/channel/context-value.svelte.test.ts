import { channelAddress } from '$lib/channel/address';
import { describe, expect, it } from 'vitest';
import {
	roomContextValue,
	type ContextDeps,
	type RoomShellProps,
} from '$lib/channel/context-value.svelte';

/**
 * The one risk in lifting ADR-0020's contract out of ChannelShell (#686): the
 * props object crosses a function boundary, so if the context captured values
 * instead of reading through the reactive object, every place would freeze at
 * whatever the room was when it opened — and nothing would fail loudly. Svelte
 * warns about exactly this shape at the call site, which is why the suppression
 * there points at this file.
 *
 * These read the getters twice with a mutation in between. Nothing else here
 * needs testing: the rest is pass-through.
 */

function deps(props: RoomShellProps) {
	const noop = () => {};
	return {
		props,
		// The context reaches live/av/ride/profile through the connection; none
		// of those are exercised here, and reaching them would mean standing up
		// a room. What is under test is the props path.
		connection: {
			live: { tick: undefined, pairing: undefined },
			av: {},
			ride: {},
			profile: { current: { ftp: 250 } },
			workout: () => null,
			shared: () => undefined,
		},
		roster: { riders: [], you: undefined, block: null },
		segments: () => [],
		phase: () => 'lounge' as const,
		canControl: () => false,
		canManage: () => false,
		myRole: () => 'member',
		stageSources: () => [],
		onStage: () => null,
		focusId: () => null,
		setFocus: noop,
		openTv: noop,
		openPicker: noop,
		ban: noop,
	} as unknown as ContextDeps;
}

function shellProps(): RoomShellProps {
	// `$state` only initialises a declaration, so it cannot be returned inline.
	const props = $state({
		children: (() => {}) as unknown as RoomShellProps['children'],
		address: channelAddress('c', 'mfw-5', 'MFW 5'),
		role: 'member',
		roomName: 'MFW 5',
		members: [],
		streakWeeks: 0,
		onRole: () => {},
		onSchedule: () => {},
	} as RoomShellProps);
	return props;
}

describe('roomContextValue (#686)', () => {
	it('reads through the props object rather than capturing it', () => {
		const props = shellProps();
		const ctx = roomContextValue(deps(props));

		expect(ctx.roomName).toBe('MFW 5');
		expect(ctx.members).toEqual([]);
		expect(ctx.streakWeeks).toBe(0);

		// The page re-fetches: a channel renamed, a member arriving, the
		// crew's streak growing. Every place reads these through the context.
		props.roomName = 'Tuesday Crew';
		props.members = [{ id: 'u1', displayName: 'Mara', role: 'member' }];
		props.streakWeeks = 3;

		expect(ctx.roomName).toBe('Tuesday Crew');
		expect(ctx.members).toHaveLength(1);
		expect(ctx.streakWeeks).toBe(3);
	});

	it('keeps the defaults the destructured props used to apply', () => {
		// `props.x` does not carry a destructuring default, so the context
		// applies them instead — otherwise a crew with no code would hand a
		// place `undefined` where it had always had ''.
		const props = shellProps();
		props.streakWeeks = undefined;
		props.members = undefined;
		const ctx = roomContextValue(deps(props));
		expect(ctx.code).toBe('');
		expect(ctx.together).toBeNull();
		expect(ctx.streakWeeks).toBe(0);
		expect(ctx.board).toEqual([]);
		expect(ctx.members).toEqual([]);
		expect(ctx.announcement).toBeNull();
	});

	it('routes a callback back to the prop that is current when it fires', () => {
		const props = shellProps();
		const ctx = roomContextValue(deps(props));
		const calls: string[] = [];

		props.onClearAnnouncement = () => calls.push('first');
		ctx.clearAnnouncement();

		// The page can hand down a new handler; the context must not be holding
		// the one it was built with.
		props.onClearAnnouncement = () => calls.push('second');
		ctx.clearAnnouncement();

		expect(calls).toEqual(['first', 'second']);
	});
});
