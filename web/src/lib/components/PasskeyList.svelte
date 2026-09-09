<script lang="ts">
	// The passkeys on this account (#782, ADR-0029) — a credential in the same
	// set as the sign-in providers beside it, which is why the last one can
	// never be removed.
	//
	// Rename and remove sit on the row as buttons rather than behind a context
	// menu: this is a settings surface, not something reached mid-ride, and
	// .claude/rules/ux.md asks that nothing live only in a menu.
	import Banner from './Banner.svelte';
	import Skeleton from './Skeleton.svelte';
	import * as passkeys from '$lib/passkeys';

	const canPasskey = passkeys.supported();

	let keys = $state<passkeys.Passkey[]>([]);
	let loaded = $state(false);
	// Why the list could not be read — the fourth state (errors.md, #1827),
	// distinct from `error`, which is a ceremony's own refusal.
	let loadError = $state<string | null>(null);
	let name = $state('');
	let busy = $state(false);
	let error = $state('');

	async function refresh() {
		const res = await passkeys.list();
		keys = res.keys;
		loadError = res.error;
		loaded = true;
	}
	if (canPasskey) void refresh();

	async function add() {
		busy = true;
		error = '';
		error = (await passkeys.add(name.trim() || 'Passkey')) ?? '';
		busy = false;
		if (!error) {
			name = '';
			await refresh();
		}
	}

	async function rename(key: passkeys.Passkey) {
		const next = prompt('Name this passkey', key.name);
		if (next === null || next.trim() === key.name) return;
		error = (await passkeys.rename(key.id, next.trim())) ?? '';
		await refresh();
	}

	async function remove(key: passkeys.Passkey) {
		error = (await passkeys.remove(key.id)) ?? '';
		await refresh();
	}

	const when = (iso?: string) =>
		iso ? new Date(iso).toLocaleDateString() : 'never used';
</script>

<div>
	<span class="eyebrow">passkeys</span>

	{#if !canPasskey}
		<p class="text-muted mt-2 text-[11px]">
			This browser cannot use passkeys. Open WattRoom in a recent Chrome, Safari
			or Firefox to add one.
		</p>
	{:else}
		{#if error}
			<div class="mt-2"><Banner>{error}</Banner></div>
		{/if}

		{#if !loaded}
			<div class="mt-2"><Skeleton rows={2} class="h-5" /></div>
		{:else if loadError}
			<div class="mt-2">
				<Banner tone="error">
					{loadError}
					{#snippet action()}
						<button onclick={() => void refresh()} class="btn-link text-xs"
							>Retry</button
						>
					{/snippet}
				</Banner>
			</div>
		{:else if keys.length === 0}
			<p class="text-muted mt-2 text-sm">
				Add one and you can sign in with your phone, your password manager or a
				security key — no provider, nothing to type.
			</p>
		{:else}
			<ul class="mt-2 grid gap-1.5">
				{#each keys as key (key.id)}
					<li class="flex items-center gap-3 text-sm">
						<span class="min-w-0 flex-1 truncate">
							{key.name}
							<span class="text-muted block text-[11px]">
								added {when(key.createdAt)} · {key.lastUsedAt
									? `last used ${when(key.lastUsedAt)}`
									: 'never used'}
							</span>
						</span>
						<button onclick={() => rename(key)} class="btn btn-ghost btn-xs"
							>Rename</button
						>
						<button onclick={() => remove(key)} class="btn btn-danger btn-xs"
							>Remove</button
						>
					</li>
				{/each}
			</ul>
		{/if}

		<div class="mt-3 flex flex-wrap items-center gap-2">
			<input
				bind:value={name}
				maxlength="40"
				placeholder="Phone, YubiKey…"
				aria-label="name for the passkey"
				class="input w-40"
			/>
			<button onclick={add} disabled={busy} class="btn btn-secondary btn-xs">
				{busy ? 'Waiting…' : 'Add a passkey'}
			</button>
		</div>
	{/if}
</div>
