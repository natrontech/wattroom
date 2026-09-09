/**
 * What we ask the browser for when we open the mic.
 *
 * `autoGainControl` is the load-bearing one, and it stays ON (#555). Turning
 * it off for #514 looked local — a fixed threshold cannot mean much while a
 * gain stage keeps moving what the level is — and it broke the room three ways
 * at once:
 *
 *   - every rider went quiet, and was lost under music at 10 %;
 *   - LiveKit decides who is speaking from the published track's level, and
 *     the room's ducking rides on that (`JukeboxDock` reads `av.speaking`), so
 *     nothing dipped for anyone any more;
 *   - gate thresholds are persisted per device against an AGC'd signal, so a
 *     rider's own stored threshold could now sit above their voice.
 *
 * The meter dancing in a silent room — what turning it off was aimed at — is
 * cosmetic beside a room that cannot hear itself. The answer there is a
 * threshold that follows the noise floor, not a gain stage switched off.
 *
 * `noiseSuppression` is OFF (ADR-0043, #1340). Chrome's suppressor is a
 * spectral gate tuned for a call centre: it takes the fan and the voice's
 * air with it, and riders heard the result as "noise reduction and stuff".
 * The gate (`gate.ts`) is what keeps the fan out of the room between
 * sentences; while a rider talks, the room hears the rider, fan and all.
 *
 * `echoCancellation` stays on: it is the only thing between a rider on
 * speakers and the room hearing itself back.
 */
export const MIC_CONSTRAINTS = {
	noiseSuppression: false,
	echoCancellation: true,
	autoGainControl: true,
} as const;
