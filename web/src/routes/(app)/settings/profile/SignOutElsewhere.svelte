<script lang="ts">
	// "Sign out everywhere else" (#1607) and what it leaves standing (#2902).
	//
	// It ends every other session and nothing more: a personal token outlives
	// the session that minted it, and revoking them all here would stop a
	// coach's tooling without warning (ADR-0017). So the result lists the
	// tokens that survived, each with the same Revoke Coach access has — a
	// rider signing out after a borrowed session sees at once whether that
	// session left a way back in.
	import Banner from '$lib/components/Banner.svelte';
	import TokenList from '$lib/profile/TokenList.svelte';
	import { api } from '$lib/api';
	import { toasts } from '$lib/toast.svelte';
	import type { ApiToken } from '../data/+page';

	let signingOut = $state(false);
	let survivors = $state<ApiToken[]>([]);
	let tokenError = $state<string | null>(null);

	async function signOutElsewhere() {
		signingOut = true;
		const res = await api<{ signedOut: number }>(
			'/api/auth/logout-everywhere',
			{ method: 'POST' },
		);
		signingOut = false;
		if (!res.ok) {
			toasts.push(res.error.message, { tone: 'error' });
			return;
		}
		const n = res.data.signedOut;
		toasts.push(
			n === 0
				? 'No other device was signed in.'
				: `Signed out on ${n} other ${n === 1 ? 'device' : 'devices'}.`,
		);
		const listed = await api<{ tokens: ApiToken[] }>('/api/tokens');
		survivors = listed.ok ? (listed.data?.tokens ?? []) : [];
		tokenError = listed.ok
			? null
			: `${listed.error.message} Your tokens are listed on Settings › Data.`;
	}
</script>

<!-- The response to "a passkey was added to your account" (ADR-0030,
     #1607): every other screen signed out, this one kept. -->
<div class="text-muted self-end pb-2 text-xs sm:col-span-2">
	<button
		onclick={signOutElsewhere}
		disabled={signingOut}
		class="btn btn-secondary btn-xs">Sign out everywhere else</button
	>
	<span class="ml-2"
		>Every other browser and device signed in to this account is signed out;
		this one stays.</span
	>
	{#if survivors.length > 0}
		<p class="text-ink mt-3" data-testid="surviving-tokens">
			Personal tokens are not signed out, and these can still read your rides.
			Revoke any you did not make.
		</p>
		<TokenList
			bind:tokens={survivors}
			onError={(message) => (tokenError = message)}
		/>
	{/if}
	{#if tokenError}
		<div class="mt-3"><Banner tone="error">{tokenError}</Banner></div>
	{/if}
</div>
