/**
 * Passkeys (#782, ADR-0029) — the browser half.
 *
 * Uses the platform's own JSON helpers (`parseCreationOptionsFromJSON`,
 * `toJSON`) rather than hand-rolling base64url ↔ ArrayBuffer both ways. They
 * are what the server already speaks, and this app is Chrome-first
 * (ADR-0004); where they are missing, `supported()` is false and the
 * affordance never renders rather than failing on click.
 */
import { api } from '$lib/api';
import { confirm } from '$lib/confirm.svelte';
import type { Me } from '$lib/account.svelte';

export interface Passkey {
	id: string;
	name: string;
	createdAt: string;
	lastUsedAt?: string;
}

// The JSON helpers are newer than the TS lib we build against; the check below
// is the runtime guarantee that these exist.
type PublicKeyCredentialWithJSON = typeof PublicKeyCredential & {
	parseCreationOptionsFromJSON(o: unknown): PublicKeyCredentialCreationOptions;
	parseRequestOptionsFromJSON(o: unknown): PublicKeyCredentialRequestOptions;
};

export function supported(): boolean {
	if (typeof PublicKeyCredential === 'undefined') return false;
	const pk = PublicKeyCredential as Partial<PublicKeyCredentialWithJSON>;
	return (
		typeof pk.parseCreationOptionsFromJSON === 'function' &&
		typeof pk.parseRequestOptionsFromJSON === 'function'
	);
}

const pk = () => PublicKeyCredential as PublicKeyCredentialWithJSON;
const toJSON = (c: Credential) =>
	(c as PublicKeyCredential & { toJSON(): unknown }).toJSON();

/** A message when it did not work, or null when it did. */
export async function add(name: string): Promise<string | null> {
	const start = await api<{ publicKey: unknown }>(
		'/api/auth/passkey/register/start',
		{ method: 'POST' },
	);
	if (!start.ok) return start.error.message;

	let credential: Credential | null;
	try {
		credential = await navigator.credentials.create({
			publicKey: pk().parseCreationOptionsFromJSON(start.data.publicKey),
		});
	} catch {
		// A cancelled prompt lands here too, which is not an error worth a banner.
		return 'That passkey was not created. Try again, or use a different device.';
	}
	if (!credential) return 'That passkey was not created. Try again.';

	const finish = await api<Passkey>(
		`/api/auth/passkey/register/finish?name=${encodeURIComponent(name)}`,
		{ method: 'POST', json: toJSON(credential) },
	);
	return finish.ok ? null : finish.error.message;
}

/** Signs in from a discoverable credential — no identifier typed anywhere. */
export async function signIn(): Promise<{ me: Me } | { error: string }> {
	const start = await api<{ publicKey: unknown }>(
		'/api/auth/passkey/login/start',
		{ method: 'POST' },
	);
	if (!start.ok) return { error: start.error.message };

	let credential: Credential | null;
	try {
		credential = await navigator.credentials.get({
			publicKey: pk().parseRequestOptionsFromJSON(start.data.publicKey),
		});
	} catch {
		return { error: 'No passkey was used. Try again, or sign in another way.' };
	}
	if (!credential) return { error: 'No passkey was used. Try again.' };

	const finish = await api<Me>('/api/auth/passkey/login/finish', {
		method: 'POST',
		json: toJSON(credential),
	});
	return finish.ok ? { me: finish.data } : { error: finish.error.message };
}

/**
 * The account's passkeys, or why they could not be read (#1827): a refused
 * list used to come back as `[]`, and a rider with five passkeys read "add
 * one" on a credential surface after a 500.
 */
export async function list(): Promise<{
	keys: Passkey[];
	error: string | null;
}> {
	const res = await api<{ passkeys?: Passkey[] }>('/api/me/passkeys');
	return res.ok
		? { keys: res.data.passkeys ?? [], error: null }
		: { keys: [], error: res.error.message };
}

export async function rename(id: string, name: string): Promise<string | null> {
	const res = await api<Passkey>(`/api/me/passkeys/${id}`, {
		method: 'PATCH',
		json: { name },
	});
	return res.ok ? null : res.error.message;
}

export async function remove(id: string): Promise<string | null> {
	const res = await api(`/api/me/passkeys/${id}`, { method: 'DELETE' });
	return res.ok ? null : res.error.message;
}

/** What removing one costs, and the way back — said before the button. */
export function removeBody(name: string): string {
	return `${name} stops signing you in, and the phone, key or password manager it lives on cannot re-create this same passkey — you would add a new one instead. Your other ways in are untouched.`;
}

/**
 * The ask before a removal (errors.md, #1493). No undo exists to offer: the
 * credential is destroyed at the authenticator's end too, and the rider finds
 * out the next time they reach for it — possibly from somewhere they cannot
 * enrol a replacement. ADR-0029 keeps the account's last way in, so this is
 * never a lock-out, which is why the body can say so.
 */
export function confirmRemoval(key: Pick<Passkey, 'name'>): Promise<boolean> {
	return confirm({
		title: `Remove “${key.name}”?`,
		body: removeBody(`“${key.name}”`),
		action: 'Remove',
		cancel: 'Keep it',
	});
}
