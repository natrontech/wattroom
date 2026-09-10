import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FILES, code } from './source-scan.test-helper';

/**
 * The inventory of irreversible actions, and the ask each one goes through
 * (#1493).
 *
 * errors.md asks first for an undo and reserves the dialog for what nothing
 * can put back — and the gap that issue found was not a missing rule but an
 * unevenly applied one: two calendar resets, a passkey removal and a
 * recovered ride's Discard fired on click while fourteen neighbours asked.
 * A rule honoured at some call sites and not others is worse than no rule,
 * because the rider learns the app does not ask.
 *
 * So the list lives here rather than in anyone's memory. **Adding an
 * irreversible action means adding a row**, which is the moment to decide
 * whether it clears the bar — and stripping an ask from one of these fails
 * loudly instead of shipping quietly.
 */
const SRC = join(import.meta.dirname, '..');

interface Guarded {
	/** Path under `src`. */
	file: string;
	/** What the rider set in motion, in the glossary's words. */
	action: string;
	/** The ask it must go through. */
	asks: RegExp;
}

const GUARDED: Guarded[] = [
	// The four #1493 closed.
	{
		file: 'lib/profile/CalendarFeed.svelte',
		action: "reset your own calendar link — every subscriber's feed goes quiet",
		asks: /confirmCalendarReset\('yours'\)/,
	},
	{
		file: 'routes/r/[slug]/sessions/+page.svelte',
		action: "reset the room's calendar link",
		asks: /confirmCalendarReset\('room'\)/,
	},
	{
		file: 'lib/components/PasskeyList.svelte',
		action: 'remove a passkey — the authenticator cannot re-mint it',
		asks: /passkeys\.confirmRemoval\(/,
	},
	{
		file: 'lib/ride/RecoveredRides.svelte',
		action: 'discard a recovered ride — this device holds the only samples',
		asks: /confirmDiscard\(/,
	},
	// The ones that already asked, listed so that stays true.
	{
		file: 'lib/board/BoardFace.svelte',
		action: 'delete a soundboard clip — the audio goes with it',
		asks: /confirm\(/,
	},
	{
		file: 'lib/components/ProviderConnections.svelte',
		action: 'disconnect a sign-in provider',
		asks: /confirm\(/,
	},
	{
		file: 'lib/crew-flows.ts',
		action: 'leave a crew — with every room of it you were in',
		asks: /confirm\(/,
	},
	{
		file: 'lib/profile/CoachAccess.svelte',
		action: 'revoke a coach token — the secret is never shown again',
		asks: /confirm\(/,
	},
	{
		file: 'lib/ride/delete-ride.ts',
		action: 'delete a ride — its trace, medals and XP',
		asks: /confirm\(/,
	},
	{
		file: 'lib/room/SessionControls.svelte',
		action: 'end the live session for everyone',
		asks: /confirm\(/,
	},
	{
		file: 'routes/crew/[id]/CrewPeople.svelte',
		action: 'ban someone from the crew',
		asks: /confirm\(/,
	},
	{
		// #2095: it did ask, but through a bespoke `Modal` spelling the safe
		// answer `Cancel`, with no danger token and the action first in the
		// DOM. The ask lives in the flow now, so this row watches the call
		// site keep going through it.
		file: 'routes/crew/[id]/CrewPeople.svelte',
		action: 'hand the crew on — only the new owner can hand it back',
		asks: /handOverCrewFlow\(/,
	},
	{
		// Tied to the copy rather than to `confirm(` alone: this file holds two
		// asks, and a bare `confirm(` row would stay green with the hand-over's
		// stripped out and leaving's left standing.
		file: 'lib/crew-flows.ts',
		action: 'hand a crew on, from the flow both call sites share',
		asks: /confirm\(\{[\s\S]{0,200}?body: HAND_OVER_BODY/,
	},
	{
		file: 'routes/crew/[id]/settings/+page.svelte',
		action: 'rotate the crew invite link — the same shape as a calendar reset',
		asks: /confirm\(/,
	},
	{
		file: 'routes/history/+page.svelte',
		action: 'clear this device’s ride summaries',
		asks: /confirm\(/,
	},
	{
		file: 'routes/music/+page.svelte',
		action: 'delete a track from your library — the file goes with it',
		asks: /confirm\(/,
	},
	{
		file: 'routes/r/[slug]/members/+page.svelte',
		action: 'remove a member, and hand the room to another owner',
		asks: /confirm\(/,
	},
	{
		file: 'routes/r/[slug]/settings/+page.svelte',
		action: 'delete the room for every member',
		asks: /confirm\(/,
	},
	{
		file: 'routes/settings/profile/+page.svelte',
		action: 'clear the recovery address',
		asks: /confirm\(/,
	},
	{
		// Not the shared dialog on purpose: typing DELETE is friction the one
		// unrecoverable action in the app is allowed to ask for.
		file: 'lib/profile/YourData.svelte',
		action: 'delete the account',
		asks: /DELETE/,
	},
];

/**
 * A primitive that destroys something, and the files allowed to reach it.
 * Anything else calling one is a call site that skipped the ask — the way
 * #1493's four came to exist in the first place.
 */
// `call` is deliberately un-`g`ged: `RegExp.test` on a global regex carries
// `lastIndex` between calls, so the second file in the sweep would be tested
// from halfway through and an offender would pass in silence.
const PRIMITIVES: { call: RegExp; callers: string[]; guard: string }[] = [
	{
		call: /(?<!function )\bdiscardRide\(/,
		callers: ['lib/ride/buffer.ts', 'lib/ride/RecoveredRides.svelte'],
		guard: 'confirmDiscard in lib/ride/recovered.ts',
	},
	{
		call: /\bpasskeys\.remove\(/,
		callers: ['lib/components/PasskeyList.svelte'],
		guard: 'passkeys.confirmRemoval',
	},
	{
		call: /\/calendar\/rotate/,
		callers: [
			'lib/profile/CalendarFeed.svelte',
			'routes/r/[slug]/+layout.svelte', // wiring; the ask is on Sessions
		],
		guard: 'confirmCalendarReset in lib/calendar-link.ts',
	},
	{
		call: /\bdeleteRide\(/,
		callers: ['lib/ride/detail.ts', 'lib/ride/delete-ride.ts'],
		guard: 'deleteRideAfterConfirm',
	},
	{
		call: /\btransferCrew\(/,
		callers: [
			'lib/crew.ts', // the definition
			'lib/crew-flows.ts',
		],
		guard: 'handOverCrewFlow in lib/crew-flows.ts',
	},
];

const read = (file: string) => code(readFileSync(join(SRC, file), 'utf8'));

describe('every irreversible action asks first (errors.md, #1493)', () => {
	it.each(GUARDED)('$file asks before it $action', ({ file, asks }) => {
		expect(FILES, `${file} moved — point this row at its new home`).toContain(
			file,
		);
		expect(
			read(file),
			`${file} performs an irreversible action without ${asks} — errors.md ` +
				'reserves the dialog for what nothing puts back, and this is one. ' +
				'If the action stopped being irreversible, delete its row here and ' +
				'give it an undo toast instead.',
		).toMatch(asks);
	});

	it.each(PRIMITIVES)(
		'$call is reached only through $guard',
		({ call, callers, guard }) => {
			const strangers = FILES.filter(
				(file) =>
					!callers.includes(file) &&
					!file.endsWith('.test.ts') &&
					call.test(read(file)),
			);
			expect(
				strangers,
				`These reach a destructive primitive without going through ${guard}:` +
					`\n  ${strangers.join('\n  ')}\n` +
					'Route the call through the guard, or add the file to `callers` ' +
					'with the reason the ask lives elsewhere.',
			).toEqual([]);
		},
	);
});
