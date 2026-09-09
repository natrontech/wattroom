<script lang="ts">
	// The address gate (#781, ADR-0029). An email is the account's recovery
	// attribute — the way back in when every provider and passkey is gone — so
	// a rider onboarded with the requirement confirms one before riding, and an
	// account that predates it is asked again each session until it does.
	//
	// Deliberately not the shared Modal: that closes on Escape and on a
	// backdrop click, and this one does not close for accounts that must
	// confirm. Signing out is the only way past it, which is the honest escape
	// for an address that will not arrive.
	import { page } from '$app/state';
	import { account } from '$lib/account.svelte';
	import {
		canSkipEmailPrompt,
		markSkipped,
		readSkipped,
		shouldPromptEmail,
	} from '$lib/account/verify-prompt';
	import Banner from './Banner.svelte';

	let skipped = $state(readSkipped());
	let address = $state('');
	let sending = $state(false);
	let error = $state('');

	const me = $derived(account.me);
	const open = $derived(shouldPromptEmail(me, skipped));
	const pending = $derived(me?.emailPending ?? '');
	const skippable = $derived(canSkipEmailPrompt(me));

	// Fill the field once, from whatever the account already knows. Guarded so
	// a later `me` refresh cannot overwrite what the rider is typing.
	$effect(() => {
		if (!address) address = pending || (me?.email ?? '');
	});

	// The link is followed in another tab — the mail client's — and `me` only
	// refreshes on a save, so the tab that asked kept the gate up after the
	// address was confirmed, with no Later button to get past it (#824). Ask
	// again while a link is out: on coming back to the tab, and every so often.
	$effect(() => {
		if (!open || !pending) return;
		const poll = () => {
			if (document.visibilityState === 'visible') void account.load();
		};
		const timer = setInterval(poll, 15_000);
		document.addEventListener('visibilitychange', poll);
		return () => {
			clearInterval(timer);
			document.removeEventListener('visibilitychange', poll);
		};
	});

	async function send() {
		if (!me || sending) return;
		sending = true;
		error = '';
		const failed = await account.save({
			displayName: me.displayName,
			ftpWatts: me.ftpWatts,
			weightKg: me.weightKg,
			email: address.trim(),
		});
		error = failed?.message ?? '';
		sending = false;
	}
</script>

{#if open}
	<div
		class="bg-paper/70 fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur"
		role="dialog"
		aria-modal="true"
		aria-label="Confirm your email address"
	>
		<div
			class="border-muted/20 bg-surface-raised w-full max-w-md rounded-xl border p-7"
		>
			<h2 class="font-display text-lg font-bold">Confirm an email address</h2>
			<p class="text-muted mt-2 text-sm">
				It is how you get back into this account if you ever lose the way you
				sign in. Nothing else uses it, and it is never shown to anyone.
			</p>
			{#if page.url.pathname.startsWith('/c/')}
				<!-- The invited rider (ADR-0038): the door they were sent to is
				     right behind this, and the gate must not read as a detour
				     away from it (audit 2026-09-09). -->
				<p class="text-muted mt-2 text-sm">
					Your crew invite is waiting right behind this.
				</p>
			{/if}

			{#if pending}
				<div class="mt-4">
					<Banner tone="ok">
						Link sent to {pending}. Open it and you are done — it works once and
						expires in a day.
					</Banner>
				</div>
			{/if}

			<label class="mt-4 block">
				<span class="eyebrow">{pending ? 'wrong address?' : 'email'}</span>
				<input
					type="email"
					bind:value={address}
					maxlength="254"
					autocomplete="email"
					class="input mt-1 w-full"
					placeholder="you@example.com"
				/>
			</label>

			{#if error}
				<div class="mt-3"><Banner>{error}</Banner></div>
			{/if}

			<div class="mt-5 flex flex-wrap items-center gap-3">
				<button
					onclick={send}
					disabled={sending || !address.trim()}
					class="btn btn-primary"
				>
					{sending ? 'Sending…' : pending ? 'Send again' : 'Send the link'}
				</button>
				{#if skippable}
					<button
						onclick={() => {
							markSkipped();
							skipped = true;
						}}
						class="btn btn-ghost">Later</button
					>
				{:else}
					<button
						onclick={() => account.signOut()}
						class="btn btn-ghost text-muted">Sign out</button
					>
				{/if}
			</div>
		</div>
	</div>
{/if}
