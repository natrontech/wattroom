<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Logo from '$lib/brand/Logo.svelte';
	import { GITHUB_MARK, GOOGLE_G } from '$lib/brand/icons';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { account } from '$lib/account.svelte';
	import { rememberNext, takeNext } from '$lib/auth/next';
	import Banner from '$lib/components/Banner.svelte';
	import * as passkeys from '$lib/passkeys';

	void account.load();

	// A discoverable passkey needs no identifier: the browser resolves the
	// account and shows the rider which one it is (#782, ADR-0029). Hidden
	// where the browser cannot do it, rather than failing on click.
	const canPasskey = passkeys.supported();
	let passkeyBusy = $state(false);
	let passkeyError = $state('');

	async function withPasskey() {
		passkeyBusy = true;
		passkeyError = '';
		const result = await passkeys.signIn();
		passkeyBusy = false;
		if ('error' in result) {
			passkeyError = result.error;
			return;
		}
		// The session cookie is set; let the store pick the account up and the
		// effect below route on from there.
		await account.load();
	}

	// ADR-0029: still no passwords. A passkey is not one.
	const providerLabels: Record<string, { label: string; note?: string }> = {
		google: { label: 'Continue with Google' },
		github: { label: 'Continue with GitHub' },
		strava: {
			label: 'Connect with Strava',
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

	<div class="relative w-full max-w-md">
		<div
			class="border-muted/20 bg-surface-raised/80 rounded-xl border px-8 py-10 text-center backdrop-blur"
		>
			<a href="/" class="inline-block" aria-label="WattRoom home">
				<Logo size={52} wordmark />
			</a>
			<p class="text-muted mt-3 text-sm">Train together, not alone.</p>

			{#if !account.loaded}
				<Skeleton class="mt-8 h-11" rows={2} />
			{:else}
				{#if canPasskey}
					<div class="mt-8">
						<button
							onclick={withPasskey}
							disabled={passkeyBusy}
							class="border-neon/40 bg-surface/60 hover:border-neon flex w-full items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium"
						>
							{passkeyBusy
								? 'Waiting for your passkey…'
								: 'Sign in with a passkey'}
						</button>
						<p class="text-muted mt-1.5 text-[11px]">
							Your phone, your password manager, or a security key.
						</p>
						{#if passkeyError}
							<div class="mt-3 text-left"><Banner>{passkeyError}</Banner></div>
						{/if}
					</div>
				{/if}
			{/if}

			{#if account.loaded && account.providers.length > 0}
				<div class="mt-4 grid gap-2.5">
					{#each account.providers as id (id)}
						{#if id === 'strava'}
							<!-- Strava's brand guidelines: their asset, unaltered, at its own size. -->
							<button onclick={() => start(id)} class="justify-self-center">
								<img
									src="/strava-connect.svg"
									alt={providerLabels[id]?.label ?? id}
									width="237"
									height="48"
								/>
								<span class="text-muted mt-1 block text-[11px]"
									>{providerLabels[id]?.note}</span
								>
							</button>
						{:else}
							<button
								onclick={() => start(id)}
								class="border-muted/25 bg-surface/60 hover:border-neon/60 flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm font-medium"
							>
								{#if id === 'google'}
									<svg viewBox="0 0 24 24" class="h-5 w-5 shrink-0">
										{#each GOOGLE_G as seg (seg.fill)}
											<path d={seg.d} fill={seg.fill} />
										{/each}
									</svg>
								{:else if id === 'github'}
									<svg viewBox="0 0 24 24" class="h-5 w-5 shrink-0 fill-current"
										><path d={GITHUB_MARK} /></svg
									>
								{:else}
									<span
										class="font-display text-neon w-5 shrink-0 text-center text-xs font-bold"
										>&gt;_</span
									>
								{/if}
								<span class="min-w-0">
									{providerLabels[id]?.label ?? id}
									{#if providerLabels[id]?.note}
										<span class="text-muted block text-[11px] font-normal"
											>{providerLabels[id].note}</span
										>
									{/if}
								</span>
							</button>
						{/if}
					{/each}
				</div>
				<p class="text-muted mt-6 text-[11px]">
					No passwords — use an account you already have.
				</p>
			{:else if account.loaded}
				<!-- Capability gating: no providers, no dead buttons — say why. A
				     passkey is only ever added from an account that already exists,
				     so without a provider nobody can make a first one. -->
				<p class="text-muted mx-auto mt-8 max-w-sm text-xs leading-relaxed">
					No sign-in providers are configured on this server, so no new account
					can be made here{canPasskey
						? ' — only an existing passkey works'
						: ''}. The operator needs to set the WATTROOM_OAUTH_* environment
					variables (or WATTROOM_DEV_LOGIN=1 in development).
				</p>
			{/if}
		</div>

		<p class="text-muted mt-5 text-center text-[11px]">
			free &amp; open source ·
			<a
				href="https://github.com/natrontech/wattroom"
				class="hover:text-ink underline">star on GitHub</a
			>
			· by
			<a href="https://natron.io" class="hover:text-ink underline">Natron</a>
			·
			<a href="/legal" class="hover:text-ink underline">legal</a>
			·
			<a href="/privacy" class="hover:text-ink underline">privacy</a>
		</p>
	</div>
</main>
