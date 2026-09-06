import { afterEach, describe, expect, it, vi } from 'vitest';
import { supported } from './passkeys';

const g = globalThis as Record<string, unknown>;

afterEach(() => {
	delete g.PublicKeyCredential;
	vi.restoreAllMocks();
});

describe('supported', () => {
	it('is false where WebAuthn is absent entirely', () => {
		expect(supported()).toBe(false);
	});

	it('is false on a browser with WebAuthn but no JSON helpers', () => {
		// Everything before Chrome 119 / Safari 17.4: the ceremony would need
		// hand-rolled base64url both ways, so the affordance stays hidden.
		g.PublicKeyCredential = function () {};
		expect(supported()).toBe(false);
	});

	it('is true once both JSON helpers exist', () => {
		const stub = function () {};
		stub.parseCreationOptionsFromJSON = () => ({});
		stub.parseRequestOptionsFromJSON = () => ({});
		g.PublicKeyCredential = stub;
		expect(supported()).toBe(true);
	});

	it('needs both, not one', () => {
		const stub = function () {};
		stub.parseCreationOptionsFromJSON = () => ({});
		g.PublicKeyCredential = stub;
		expect(supported()).toBe(false);
	});
});
