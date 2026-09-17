/**
 * What the ⚑ promises before the tap and says after it (#52, ADR-0046).
 *
 * Two surfaces, one difference, and it is deliberate: a solo ride or a ramp
 * collects flags and sends them from the summary, where a rider off the bike
 * can type a note; a room ride is left by walking away, so the tap sends. The
 * words were written out three times and only the room's said any of this
 * before the press (#2180) — consent belongs at the moment of the tap.
 */
export const FLAG_ASKS = {
	now: 'Something wrong? One tap sends your last two minutes of ride data and logs to the developers. Only yours, nobody else’s.',
	after:
		'Something wrong? One tap marks this moment — after the ride it sends your last two minutes of ride data and logs to the developers. Only yours, nobody else’s.',
} as const;

export const FLAG_SAID = {
	now: 'Flagged — your last two minutes went to the developers. Only yours, nobody else’s.',
	after:
		'Flagged — after the ride this sends your last two minutes of ride data and logs to the developers. Only yours, nobody else’s.',
} as const;

/** How long the acknowledgement stays on a screen a rider glances at. */
export const FLAG_NOTICE_MS = 4000;
