/**
 * Noise cancellation: DeepFilterNet3 on the rider's own machine, in front of
 * the gate (docs/RESEARCH.md §22).
 *
 * A gate only chooses between the room and silence, and it reads a level: a
 * fan, a drivetrain and heavy breathing all sit in the voice's band, close to
 * the mic, so on a noisy bike the gate stayed open and the call heard all of
 * it. This takes them out from under the voice as well, and the gate then
 * reads a signal with nothing left in it but the rider.
 *
 * Its Wasm and model are 23 MB (12 MB on the wire, once, cached for good), so
 * they load on the first open mic and never with the page. Its own pause gate
 * stays off: `voice-dsp.ts` is the gate.
 */

/** How far the model may go under a voice. Past this the room's last trace
 *  goes, and listeners hear dropouts and a metallic edge (the package's own
 *  listening tests); 40 dB still scores PESQ 3.0 on a fan, against 2.8 at 25. */
const ATTENUATION_DB = 40;

export interface Denoiser {
	node: AudioNode;
	dispose(): void;
}

export async function createDenoiser(
	ctx: AudioContext,
	/** The audio thread cannot keep up: 70 % of real time, for 4 s. */
	overloaded: () => void,
): Promise<Denoiser> {
	const { createDeepFilterNetAudioWorklet } =
		await import('@workadventure/noise-suppression/deepfilternet');
	const worklet = await createDeepFilterNetAudioWorklet(ctx, {
		speechAttenuationDb: ATTENUATION_DB,
		pauseAttenuationDb: 0,
		onOverload: overloaded,
	});
	await worklet.ready;
	return worklet;
}
