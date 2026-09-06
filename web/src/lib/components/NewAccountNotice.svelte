<script lang="ts">
	// A sign-in that *created* an account says so (#784, ADR-0029).
	//
	// Linking a second provider works, but only for a rider who knows to link:
	// signing in with an unlinked one lands in a fresh, empty account instead,
	// and until now nothing said so. Merging is not the fix — that is the
	// pre-hijacking attack class ADR-0029 rules out — so recognition is, at the
	// one moment undoing it is still cheap.
	//
	// In flow, like WhatsNewNotice beside it, and deliberately not an overlay:
	// a fixed card over the app steals clicks from whatever it covers, which
	// e2e found by failing to press "Join room" underneath one.
	import { goto } from '$app/navigation';
	import { account } from '$lib/account.svelte';
	import { nameOf } from '$lib/auth/providers';
	import { takeNewAccount } from '$lib/auth/new-account';

	const provider = takeNewAccount();
	let dismissed = $state(false);

	async function useAnother() {
		await account.signOut();
		void goto('/login', { replaceState: true });
	}
</script>

{#if provider && !dismissed}
	<div
		class="border-neon/30 bg-surface-raised mt-6 rounded-xl border p-5"
		role="status"
	>
		<p class="text-sm font-medium">
			New account, created with {nameOf(provider)}.
		</p>
		<p class="text-muted mt-1 text-xs leading-relaxed">
			If you meant to sign into one you already had, your rides are on that
			account and not this one. Sign out, come back with the provider you used
			before, and you can connect {nameOf(provider)} to it from your profile.
		</p>
		<div class="mt-3 flex flex-wrap items-center gap-2">
			<button
				onclick={() => (dismissed = true)}
				class="btn btn-secondary btn-xs">This is my account</button
			>
			<button onclick={useAnother} class="btn btn-ghost btn-xs"
				>Use a different provider</button
			>
		</div>
	</div>
{/if}
