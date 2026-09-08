import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * 3 s of pink noise (e2e/fixtures/fake-voice.wav), looped by Chromium's fake
 * capture device as voice-duck.spec.ts's "remote microphone". The device's
 * default beep pattern is mostly silence between short beeps — real enough to
 * flip a state machine once, not real enough to hold a gate open for a
 * multi-second assertion. Noise rather than a pure tone: a dead-flat sine has
 * no amplitude variance at all, the one property speech-detection heuristics
 * anywhere in the chain (WebRTC's own DTX included) key off to tell signal
 * from silence.
 */
const fakeVoiceWav = fileURLToPath(
	new URL('./e2e/fixtures/fake-voice.wav', import.meta.url),
);

/**
 * PLAYWRIGHT_BASE_URL points the suite at a deployed target (the production
 * synthetic, #153). Unset, everything below behaves exactly as before: build,
 * serve locally, ride that. The workflow used to set this variable while the
 * config ignored it, so the "production" synthetic was really testing a fresh
 * local build — green while production was down.
 */
const external = process.env.PLAYWRIGHT_BASE_URL;

/**
 * One end-to-end flow (WATTROOM.md): simulated trainer rides a workout and produces
 * a .fit. It exercises the seam nothing else covers — browser ride loop, real
 * workout engine, HTTP, and the Go encoder — so it is deliberately the only e2e
 * test rather than the first of many.
 *
 * Chromium only: Web Bluetooth exists nowhere else, and the app says so itself.
 */
export default defineConfig({
	testDir: 'e2e',
	// The smoke rides a real minute; the default 30 s cap would kill it.
	timeout: 5 * 60 * 1000,
	expect: { timeout: 10_000 },
	fullyParallel: false,
	// Two workers, not one: the ride spec is two real minutes and the other three
	// specs together are under one, so they finish alongside it instead of after
	// it. More workers buys nothing — the ride is the floor — and would only put
	// browsers in contention with the Go server on a 4-core runner.
	workers: process.env.CI ? 2 : undefined,
	forbidOnly: !!process.env.CI,
	retries: 0,
	reporter: process.env.CI ? 'github' : 'list',
	use: {
		baseURL: external || 'http://localhost:4173',
		trace: 'retain-on-failure',
	},
	projects: [
		{
			name: 'chromium',
			testIgnore: [
				'mobile-room.spec.ts',
				'phone-width.spec.ts',
				'voice-duck.spec.ts',
			],
			use: { ...devices['Desktop Chrome'] },
		},
		{
			// A real phone profile, not a narrow desktop window: device.svelte.ts
			// reads pointer and Bluetooth signals, not width alone (#412), so a
			// dragged-narrow Chrome would render desktop affordances and the
			// phone specs would pass against a room a phone never sees.
			// phone-width.spec.ts overrides the viewport to the 375×812 the
			// standard is written at, and keeps this device's touch pointer.
			name: 'phone',
			testMatch: ['mobile-room.spec.ts', 'phone-width.spec.ts'],
			use: { ...devices['Pixel 5'] },
		},
		{
			// voice-duck.spec.ts is the one spec that needs a real microphone
			// signal rather than none: Chromium's fake capture device (real
			// audio, not silence) so getUserMedia produces something the mic
			// gate and the meter actually see. Scoped to its own project —
			// every other spec keeps the plain Desktop Chrome launch.
			// No --mute-audio and no zeroed mixer (AGENTS.md's usual "mute
			// before you play"): this spec's whole point is a real voice
			// actually being heard, which AGENTS.md itself carves out —
			// "Unless the audio is the thing under test". A real GitHub
			// Actions runner has no speaker to reach either way; a developer
			// running this locally hears one 3 s loop, once, per run.
			name: 'voice',
			testMatch: ['voice-duck.spec.ts'],
			use: {
				...devices['Desktop Chrome'],
				launchOptions: {
					args: [
						'--use-fake-device-for-media-stream',
						'--use-fake-ui-for-media-stream',
						'--autoplay-policy=no-user-gesture-required',
						`--use-file-for-fake-audio-capture=${fakeVoiceWav}`,
					],
				},
			},
		},
	],
	// Serves the built SPA and proxies /api to the Go server, matching production.
	//
	// Always builds, never reuses: the server only ever serves build/, so a reused
	// process happily serves a stale bundle and the run passes against code that is
	// not the code under test. A route added since the last build 404s — which is
	// exactly how this was found. The build costs seconds against a two-minute ride.
	// Against a deployed target there is nothing to serve: the synthetic rides
	// production, and a local server would silently make it a self-test.
	webServer: external
		? undefined
		: {
				command: 'pnpm build && node e2e/server.js',
				url: 'http://localhost:4173/ride',
				reuseExistingServer: false,
				timeout: 120_000,
			},
});
