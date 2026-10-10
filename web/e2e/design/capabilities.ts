/**
 * The platform capabilities the app branches on, pinned for every design shot
 * (#3884): a shot taken on Linux CI (SwiftShader) and on a Mac (Metal) must
 * draw the same Pair state and the same Share or Copy label, so a reviewer
 * never grades the platform. Harness only; the app is untouched.
 */
export interface Capabilities {
	/** Web Bluetooth present: a rider's browser that can pair a trainer. */
	bluetooth: boolean;
}

/** What a shot reports of the page it drew, beside its probes. */
export function readCapabilities() {
	return {
		bluetooth: 'bluetooth' in navigator && !!navigator.bluetooth,
		share: typeof navigator.share,
		pointerFine: matchMedia('(pointer: fine)').matches,
		hoverHover: matchMedia('(hover: hover)').matches,
	};
}

/**
 * Runs in the page before any script. Bluetooth is a stub that dismisses its
 * chooser as a rider would (every ride here is the simulated trainer's), or
 * is gone. `navigator.share` is gone: Chrome on a Mac has it and headless
 * Linux does not, and the app shows Share over Copy on a finger with it.
 */
export function pinCapabilities({ bluetooth }: Capabilities) {
	const proto = Navigator.prototype;
	const stub = {
		requestDevice: () =>
			Promise.reject(
				new DOMException('User cancelled the chooser.', 'NotFoundError'),
			),
	};
	for (const own of ['bluetooth', 'share', 'canShare'])
		delete (navigator as unknown as Record<string, unknown>)[own];
	for (const name of ['bluetooth', 'share', 'canShare'])
		delete (proto as unknown as Record<string, unknown>)[name];
	if (bluetooth)
		Object.defineProperty(proto, 'bluetooth', {
			get: () => stub,
			configurable: true,
		});
}
