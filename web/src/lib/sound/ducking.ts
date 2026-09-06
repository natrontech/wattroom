/**
 * The SPEC ducking envelope (docs/SPEC.md "Room audio defaults", #24/#152),
 * owned here the way `fader.ts` owns every fader's travel: the jukebox and the
 * cue bus both dip under a voice, and a rider hears one duck, not two — so the
 * depth and the ballistics have one home (#675).
 */

/**
 * How hard voice ducking dips music and cues, out of the box (SPEC.md: "to
 * 25 % of the rider's own volume"), as a multiplier on the rider's own level.
 * The mixer's default — its knob runs 0 (silence under a voice) … 1 (off) —
 * and the cue engine's fallback before the mixer has spoken, one constant so
 * the two can't drift apart the way they did (#677).
 */
export const DUCK_DEFAULT = 0.25;

/** Down: fast enough that the first word is not fought over. */
export const DUCK_ATTACK_MS = 150;

/** Stay down this long after the voice stops, so a breath between sentences does not pump the mix. */
export const DUCK_HOLD_MS = 600;

/** Up: slow enough to read as the room settling, never a snap. */
export const DUCK_RELEASE_MS = 400;

/**
 * Whether the room should be ducking right now, from LiveKit's speaking map.
 * The music and the cue bus both ask this — one duck, one rule, the way the
 * depth and the ballistics above already have one home (#675).
 *
 * `myId` is left out unless `ownVoice` is set: your own voice pulling the
 * music down under you is a taste, not the default (#867). An empty `myId`
 * (not signed in yet, mock surfaces) ducks under every voice, which is the
 * safe direction — a rider is never made to talk over music they can't dip.
 */
export function shouldDuck(
	speaking: Record<string, boolean | undefined>,
	myId: string | undefined,
	ownVoice: boolean,
): boolean {
	return Object.entries(speaking).some(
		([id, active]) => active && (ownVoice || id !== myId),
	);
}
