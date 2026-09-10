<script lang="ts">
	// The way back in (#1822, ADR-0051). Reached from the sign-in page and
	// from every account alarm mail, by a rider whose passkey, provider or
	// whole session is gone — so it asks for one thing, types nothing else,
	// and never says whether the address it was given belongs to an account.
	import { onMount } from 'svelte';
	import Logo from '$lib/brand/Logo.svelte';
	import Banner from '$lib/components/Banner.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { account } from '$lib/account.svelte';
	import { api } from '$lib/api';

	void account.load();

	let address = $state('');
	let sending = $state(false);
	/** The field's own refusal — a malformed address, or too many asks. */
	let fieldError = $state('');
	/** Anything else the server or the network answered. */
	let error = $state('');
	let sent = $state(false);
	let field = $state<HTMLInputElement | null>(null);

	// A text-first task: the cursor belongs in the one field (ux.md).
	onMount(() => field?.focus());

	async function ask(event: SubmitEvent) {
		event.preventDefault();
		if (sending || !address.trim()) return;
		sending = true;
		fieldError = '';
		error = '';
		const res = await api<void>('/api/auth/recover', {
			method: 'POST',
			json: { email: address.trim() },
		});
		sending = false;
		if (res.ok) {
			sent = true;
			return;
		}
		if (res.error.field) fieldError = res.error.message;
		else error = res.error.message;
	}
</script>

<svelte:head><title>Get back in · WattRoom</title></svelte:head>

<main
	class="cave bg-surface text-ink relative grid min-h-dvh place-items-center px-6"
>
	<div
		class="bg-gridlines pointer-events-none absolute inset-x-0 top-0 h-[45dvh] opacity-40"
		aria-hidden="true"
	></div>

	<div class="relative w-full max-w-md">
		<div
			class="border-muted/20 bg-surface-raised/80 rounded-xl border px-8 py-10 backdrop-blur"
		>
			<a href="/" class="inline-block" aria-label="WattRoom home">
				<Logo size={44} wordmark />
			</a>

			{#if !account.loaded}
				<Skeleton class="mt-8 h-11" rows={2} />
			{:else if account.unreachable}
				<!-- Not "unconfigured": the question never reached the server. -->
				<div class="mt-8">
					<Banner tone="error">
						The server could not be reached — check your connection and try
						again.
						{#snippet action()}
							<button
								onclick={() => void account.load()}
								class="btn-link text-xs">Retry</button
							>
						{/snippet}
					</Banner>
				</div>
			{:else if !account.mailAvailable}
				<!-- Capability gating: no mail, no recovery. A form here would
				     fail on submit for every rider on this server. -->
				<h1 class="page-title mt-6">Recovery is not set up on this server</h1>
				<p class="text-muted mt-2 text-sm leading-relaxed">
					This WattRoom cannot send email, so there is no link to send. Ask
					whoever runs it to help you back into your account.
				</p>
			{:else if sent}
				<!-- Deliberately the same words whether or not the address is on an
				     account: the server does not say, and neither does this. -->
				<h1 class="page-title mt-6">Check your email</h1>
				<p class="text-muted mt-2 text-sm leading-relaxed">
					If <span class="text-ink">{address.trim()}</span> is the confirmed address
					on a WattRoom account, a sign-in link is on its way. It works once and expires
					in a day.
				</p>
				<p class="text-muted mt-3 text-sm leading-relaxed">
					Opening it signs that account out everywhere else, so you will be the
					only one in it.
				</p>
				<button
					onclick={() => {
						sent = false;
					}}
					class="btn-link mt-5 text-xs">Use a different address</button
				>
			{:else}
				<h1 class="page-title mt-6">Get back into your account</h1>
				<p class="text-muted mt-2 text-sm leading-relaxed">
					Lost your passkey, or the sign-in you used? We mail a one-time link to
					the address confirmed on the account.
				</p>

				<form onsubmit={ask} class="mt-6">
					<label class="block">
						<span class="eyebrow">your email address</span>
						<input
							bind:this={field}
							type="email"
							bind:value={address}
							maxlength="254"
							autocomplete="email"
							class="input mt-1 w-full"
							placeholder="you@example.com"
							aria-describedby={fieldError ? 'recover-field-error' : undefined}
						/>
					</label>
					{#if fieldError}
						<p id="recover-field-error" class="text-danger mt-2 text-xs">
							{fieldError}
						</p>
					{/if}
					{#if error}
						<div class="mt-3"><Banner>{error}</Banner></div>
					{/if}
					<button
						type="submit"
						disabled={sending || !address.trim()}
						class="btn btn-primary btn-lg mt-5 w-full"
					>
						{sending ? 'Sending…' : 'Email me a link'}
					</button>
				</form>

				<p class="text-muted mt-5 text-xs leading-relaxed">
					No confirmed address on the account? Then there is no way back in from
					here — ask whoever runs this WattRoom.
				</p>
			{/if}

			<p class="mt-6 text-xs">
				<a href="/login" class="text-muted hover:text-ink underline"
					>Back to sign in</a
				>
			</p>
		</div>
	</div>
</main>
