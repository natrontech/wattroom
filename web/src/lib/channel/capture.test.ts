import { afterEach, describe, expect, it, vi } from 'vitest';
import { MIC_CONSTRAINTS, type MicDevices, captureMic } from './capture';

describe('mic capture constraints (#555)', () => {
	it('keeps automatic gain control on', () => {
		// Not a preference: LiveKit reads the published track's level to decide
		// who is speaking, the jukebox ducks from that, and every rider's
		// stored gate threshold was set against an AGC'd signal. Switching this
		// off once made the call inaudible and stopped the music dipping.
		expect(MIC_CONSTRAINTS.autoGainControl).toBe(true);
	});

	it('keeps echo cancellation — the one DSP a rider on speakers needs', () => {
		expect(MIC_CONSTRAINTS.echoCancellation).toBe(true);
	});

	it('sends the voice without noise suppression (ADR-0043, #1340)', () => {
		expect(MIC_CONSTRAINTS.noiseSuppression).toBe(false);
	});
});

describe('the browser suppressor', () => {
	const devices = (micId: string): MicDevices => ({
		micId,
		besideBluetooth: null,
		forgetMicIfUnplugged: () => {},
		heardNothing: () => {},
		refresh: async () => {},
	});
	const asked = async (micId: string, handheld: boolean) => {
		const getUserMedia = vi.fn(async () => ({ getTracks: () => [] }));
		vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
		await captureMic(devices(micId), handheld);
		return getUserMedia.mock.calls[0] as unknown as [
			{ audio: MediaTrackConstraints },
		];
	};

	afterEach(() => vi.unstubAllGlobals());

	it('is what a handheld has, on any mic: no gate and no model run there', async () => {
		for (const micId of ['', 'usb']) {
			const [{ audio }] = await asked(micId, true);
			expect(audio.noiseSuppression).toBe(true);
			expect(audio.echoCancellation).toBe(true);
		}
	});

	it('stays off where noise cancellation runs', async () => {
		for (const micId of ['', 'usb']) {
			const [{ audio }] = await asked(micId, false);
			expect(audio.noiseSuppression).toBe(false);
		}
	});
});
