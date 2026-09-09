<script lang="ts">
	// What the app promises about a rider's data, and the two ways out of it:
	// export everything, or purge the account.
	//
	// Its own file because the purge owns three pieces of state and a request
	// that nothing else on the profile page reads, and because the destructive
	// half wants to be read on its own (#126, #686).
	import { account } from '$lib/account.svelte';
	import { api, apiBlob } from '$lib/api';
	import Banner from '$lib/components/Banner.svelte';
	import { downloadBlob } from '$lib/download';

	// Failures are said where the button is (errors.md): the page's own
	// status line at the far end of the page held a fixed sentence while
	// the server's reason was thrown away (audit 2026-09-09).
	let exportError = $state<string | null>(null);
	let purgeError = $state<string | null>(null);

	let confirming = $state(false);
	let typed = $state('');
	let deleting = $state(false);
	let exporting = $state(false);

	// Fetched and saved from the app: a plain link replaced the whole SPA
	// with a JSON error body when the export failed (audit 2026-09-09).
	async function exportAll() {
		exporting = true;
		const res = await apiBlob('/api/me/export');
		exporting = false;
		if (!res.ok) {
			exportError = res.error.message;
			return;
		}
		exportError = null;
		downloadBlob(res.data.blob, res.data.filename ?? 'wattroom-export.json');
	}

	async function remove() {
		deleting = true;
		const res = await api('/api/me', { method: 'DELETE' });
		deleting = false;
		if (res.ok) {
			await account.signOut();
			location.href = '/';
		} else {
			purgeError = `${res.error.message} Nothing was removed.`;
		}
	}
</script>

<section class="panel mt-3 p-6">
	<h2 class="font-display font-bold">Your data</h2>
	<ul class="text-muted mt-3 space-y-1.5 text-xs">
		<li>Rides are private by default — sharing is per ride, and opt-in.</li>
		<li>
			Live power is visible only inside a room, only while you're riding it.
		</li>
		<li>
			Voice and camera are never recorded. They pass through and are gone.
		</li>
		<li>Heart rate is health data and is treated as such.</li>
	</ul>
	<div class="mt-5 flex flex-wrap gap-2">
		<button onclick={exportAll} disabled={exporting} class="btn btn-secondary"
			>{exporting ? 'Exporting…' : 'Export everything'}</button
		>
		<button
			onclick={() => account.signOut()}
			class="btn-link self-center text-xs">Sign out</button
		>
	</div>
	{#if exportError}
		<div class="mt-3"><Banner tone="error">{exportError}</Banner></div>
	{/if}

	<!-- The destructive action lives apart from the routine ones (#126). -->
	<div class="border-ink/5 mt-6 border-t pt-4">
		<button onclick={() => (confirming = true)} class="btn btn-danger"
			>Delete account</button
		>
	</div>

	{#if confirming}
		<!-- Confirmation dialogs are for the genuinely destructive only. -->
		<div class="border-danger/50 bg-danger/10 mt-4 rounded-lg border p-5">
			<p class="text-sm font-medium">This deletes everything, permanently.</p>
			<p class="text-muted mt-1.5 text-xs leading-relaxed">
				Every ride and its samples, your power curve, your XP, your medals and
				memberships — and the rooms you own are deleted for everyone in them,
				chat and planned sessions included; a crew you own is handed to another
				owner or closed. There is no undo and no backup we can restore from —
				that's the point of a full purge.
			</p>
			<label class="mt-4 block">
				<span class="text-muted text-[11px]">Type DELETE to confirm</span>
				<input bind:value={typed} class="input mt-1 w-full font-mono" />
			</label>
			{#if purgeError}
				<div class="mt-3"><Banner tone="error">{purgeError}</Banner></div>
			{/if}
			<div class="mt-3 flex gap-2">
				<button
					onclick={remove}
					disabled={typed !== 'DELETE' || deleting}
					class="btn btn-danger-solid">Delete my account</button
				>
				<button
					onclick={() => {
						confirming = false;
						typed = '';
					}}
					class="btn btn-secondary">Cancel</button
				>
			</div>
		</div>
	{/if}
</section>
