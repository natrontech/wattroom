import { describe, expect, it } from 'vitest';
import {
	roomContextValue,
	type ContextDeps,
	type RoomShellProps,
} from '$lib/room/room-context-value.svelte';

/**
 * The one risk in lifting ADR-0020's contract out of RoomShell (#686): the
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
		myRole: () => 'member',
		stageSources: () => [],
		onStage: () => null,
		reminders: () => [],
		focusId: () => null,
		setFocus: noop,
		openTv: noop,
		openPicker: noop,
		ban: noop,
		startScheduled: noop,
		copyIcsUrl: noop,
	} as unknown as ContextDeps;
}

function shellProps(): RoomShellProps {
	// `$state` only initialises a declaration, so it cannot be returned inline.
	const props = $state({
		children: (() => {}) as unknown as RoomShellProps['children'],
		slug: 'mfw-5',
		role: 'member',
		roomName: 'MFW 5',
		members: [],
		upcoming: [],
		adminBusy: false,
		onRole: () => {},
		onRemove: () => {},
		onGrant: () => {},
		onRevoke: () => {},
		onTransfer: () => {},
		onSchedule: () => {},
		onReschedule: () => {},
		onUnschedule: () => {},
		onRsvp: () => {},
		onRotateIcs: () => {},
	});
	return props;
}

describe('roomContextValue (#686)', () => {
	it('reads through the props object rather than capturing it', () => {
		const props = shellProps();
		const ctx = roomContextValue(deps(props));

		expect(ctx.roomName).toBe('MFW 5');
		expect(ctx.members).toEqual([]);
		expect(ctx.adminBusy).toBe(false);

		// The page re-fetches: a room renamed in settings, a member arriving,
		// an admin action starting. Every place reads these through the context.
		props.roomName = 'Tuesday Crew';
		props.members = [{ id: 'u1', displayName: 'Mara', role: 'member' }];
		props.adminBusy = true;

		expect(ctx.roomName).toBe('Tuesday Crew');
		expect(ctx.members).toHaveLength(1);
		expect(ctx.adminBusy).toBe(true);
	});

	it('keeps the defaults the destructured props used to apply', () => {
		// `props.x` does not carry a destructuring default, so the context
		// applies them instead — otherwise a room with no icon would hand a
		// place `undefined` where it had always had ''.
		const ctx = roomContextValue(deps(shellProps()));
		expect(ctx.icon).toBe('');
		expect(ctx.code).toBe('');
		expect(ctx.icsToken).toBe('');
		expect(ctx.together).toBeNull();
		expect(ctx.streakWeeks).toBe(0);
		expect(ctx.monthKj).toBe(0);
		expect(ctx.medals).toEqual([]);
	});

	it('routes a callback back to the prop that is current when it fires', () => {
		const props = shellProps();
		const ctx = roomContextValue(deps(props));
		const calls: string[] = [];

		props.onRole = (userId, role) => calls.push(`first:${userId}:${role}`);
		ctx.setRole('u1', 'coach');

		// The page can hand down a new handler; the context must not be holding
		// the one it was built with.
		props.onRole = (userId, role) => calls.push(`second:${userId}:${role}`);
		ctx.setRole('u2', 'member');

		expect(calls).toEqual(['first:u1:coach', 'second:u2:member']);
	});
});
