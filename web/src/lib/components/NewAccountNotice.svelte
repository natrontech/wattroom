<script lang="ts">
	// A sign-in that *created* an account says so (#784, ADR-0029).
	//
	// Linking a second provider works, but only for a rider who knows to link:
	// signing in with an unlinked one lands in a fresh, empty account instead,
	// and until now nothing said so. Merging is not the fix — that is the
	// pre-hijacking attack class ADR-0029 rules out — so recognition is, at the
	// one moment undoing it is still cheap.
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { account } from '$lib/account.svelte';
	import { nameOf } from '$lib/auth/providers';

	// Latched: the layout routes "/" onward within a tick, taking the query
	// parameter with it, so reading it once is the only way to keep it.
	let provider = $state<string | null>(null);
	let dismissed = $state(false);

	$effect(() => {
		const seen = page.url.searchParams.get('new');
		if (seen && provider === null) provider = seen;
	});

	async function useAnother() {
		await account.signOut();
		void goto('/login', { replaceState: true });
	}
</script>

{#if provider && !dismissed}
	<div class="fixed inset-x-0 bottom-0 z-40 flex justify-center p-4">
		<div
			class="border-muted/25 bg-surface-raised max-w-lg rounded-xl border p-5 shadow-lg"
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
	</div>
{/if}
