import type { BrowserContext } from '@playwright/test';

/**
 * Make `getUserMedia({ audio: … })` on this context return a live tone
 * instead of asking for real (or Chromium-faked) hardware — vibrato on a
 * sawtooth rather than a flat sine, so the signal has the amplitude and
 * harmonic variance a dead-flat test tone lacks, in case anything downstream
 * (WebRTC's own DTX included) leans on that to tell signal from silence.
 */
export async function fakeMicrophone(ctx: BrowserContext): Promise<void> {
	await ctx.addInitScript(() => {
		const real = navigator.mediaDevices.getUserMedia.bind(
			navigator.mediaDevices,
		);
		navigator.mediaDevices.getUserMedia = async (constraints) => {
			if (!constraints?.audio) return real(constraints);
			const audioCtx = new AudioContext();
			const osc = new OscillatorNode(audioCtx, {
				type: 'sawtooth',
				frequency: 180,
			});
			const vibrato = new OscillatorNode(audioCtx, { frequency: 5 });
			const vibratoDepth = new GainNode(audioCtx, { gain: 40 });
			vibrato.connect(vibratoDepth).connect(osc.detune);
			const level = new GainNode(audioCtx, { gain: 0.5 });
			const dest = audioCtx.createMediaStreamDestination();
			osc.connect(level).connect(dest);
			osc.start();
			vibrato.start();
			return dest.stream;
		};
	});
}
