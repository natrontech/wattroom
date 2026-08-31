<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Logo from '$lib/brand/Logo.svelte';
	import { account } from '$lib/account.svelte';
	import { rememberNext, takeNext } from '$lib/auth/next';

	void account.load();

	// WATTROOM.md: social OAuth only — no passwords, ever.
	const providerLabels: Record<string, { label: string; note?: string }> = {
		google: { label: 'Continue with Google' },
		github: { label: 'Continue with GitHub' },
		strava: {
			label: 'Continue with Strava',
			note: 'also connects ride upload',
		},
		dev: { label: 'Dev sign-in (local only)' },
	};

	// Already signed in (or just returned from OAuth): straight through.
	$effect(() => {
		if (account.loaded && account.me) {
			void goto(takeNext() ?? '/rooms', { replaceState: true });
		}
	});

	function start(id: string) {
		rememberNext(page.url.searchParams.get('next'));
		window.location.href = `/api/auth/${id}/start`;
	}
</script>

<main
	class="cave bg-surface text-ink relative grid min-h-dvh place-items-center px-6"
>
	<div
		class="bg-gridlines pointer-events-none absolute inset-x-0 top-0 h-[45dvh] opacity-40"
		aria-hidden="true"
	></div>

	<div
		class="border-muted/15 bg-surface-raised relative w-full max-w-md rounded-lg border px-8 py-10 text-center"
	>
		<Logo size={56} wordmark />
		<p class="text-muted mt-4 text-sm">Train together, not alone.</p>

		{#if !account.loaded}
			<p class="text-muted mt-8 text-sm">Loading…</p>
		{:else if account.providers.length > 0}
			<p class="text-muted mx-auto mt-6 max-w-sm text-xs leading-relaxed">
				No passwords — WattRoom uses accounts you already have. Strava also
				connects ride upload, so you can skip that step later.
			</p>
			<div class="mx-auto mt-7 grid max-w-xs gap-2">
				{#each account.providers as id (id)}
					<button
						onclick={() => start(id)}
						class="border-muted/25 hover:border-muted/60 w-full rounded border px-4 py-3 text-sm"
					>
						{providerLabels[id]?.label ?? id}
						{#if providerLabels[id]?.note}
							<span class="text-muted block text-[11px]"
								>{providerLabels[id].note}</span
							>
						{/if}
					</button>
				{/each}
			</div>
		{:else}
			<!-- Capability gating: no providers, no dead buttons — say why. -->
			<p class="text-muted mx-auto mt-8 max-w-sm text-xs leading-relaxed">
				No sign-in providers are configured on this server, so nobody can sign
				in. The operator needs to set the WATTROOM_OAUTH_* environment variables
				(or WATTROOM_DEV_LOGIN=1 in development).
			</p>
		{/if}
	</div>
</main>
