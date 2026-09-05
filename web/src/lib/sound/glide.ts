/**
 * Moves an AudioParam to `target` over a ramp that reads as `ms` long.
 *
 * `setTargetAtTime` is exponential and never quite arrives, so its time
 * constant is a third of the ramp: at 3τ the value is 95 % of the way, which
 * is where an ear calls it done. One helper so the gate, the cue ducker and
 * anything else that fades agrees on what "over 150 ms" means.
 */
export function glideTo(
	param: AudioParam,
	target: number,
	at: number,
	ms: number,
): void {
	param.setTargetAtTime(target, at, ms / 3000);
}
