<script lang="ts">
	/**
	 * The first thing a new account is asked (#1484): the two numbers every
	 * FTP-relative target scales from.
	 *
	 * Until this landed nobody was asked at all — an account was created with
	 * 200 W and 75 kg, and the execution score, the XP bonus, the category and
	 * the training load were all anchored to a number nobody chose. Asked
	 * here, in the setting-up card the rider is already reading, rather than
	 * behind a modal or a gate: a rider who skips it still rides, and Home
	 * labels the number a starting guess until they answer.
	 *
	 * Prefilled with what the account already holds, which for a new one is
	 * exactly those defaults — keeping them is a valid answer, so the save
	 * claims both sources outright rather than leaving the server to infer an
	 * answer from a value that did not change.
	 */
	import { account } from '$lib/account.svelte';
	import { PROFILE_LIMITS } from '$lib/profile.svelte';

	/** The step's own label, so the row reads the same open as struck out. */
	let { label }: { label: string } = $props();

	let ftp = $state(account.me?.ftpWatts ?? 200);
	let kg = $state(account.me?.weightKg ?? 75);
	let saving = $state(false);
	let error = $state<{ message: string; field?: string } | null>(null);

	async function save() {
		const me = account.me;
		if (!me || saving) return;
		saving = true;
		// Claimed, not inferred: both sources say "the rider answered" even
		// when the answer is the prefilled number.
		error = await account.save({
			displayName: me.displayName,
			ftpWatts: ftp,
			weightKg: kg,
			ftpSource: 'manual',
			weightSource: 'manual',
		});
		saving = false;
	}
</script>

<div class="py-2">
	<p class="text-sm font-medium">{label}</p>
	<p class="text-muted mt-0.5 text-xs">
		Every workout's targets scale from your FTP, so the 200 W we start everyone
		on makes every session a guess.
		<a href="/ramp" class="hover:text-ink underline">A ramp test measures it</a
		>, or put in what you know.
	</p>
	<div class="mt-3 flex flex-wrap items-end gap-3">
		<label class="block">
			<span class="eyebrow">FTP (W)</span>
			<input
				type="number"
				bind:value={ftp}
				min={PROFILE_LIMITS.minFtp}
				max={PROFILE_LIMITS.maxFtp}
				aria-invalid={error?.field === 'ftpWatts' ? 'true' : undefined}
				class="input mt-1 w-24 font-mono tabular-nums"
			/>
		</label>
		<label class="block">
			<span class="eyebrow">weight (kg)</span>
			<input
				type="number"
				bind:value={kg}
				min={PROFILE_LIMITS.minKg}
				max={PROFILE_LIMITS.maxKg}
				aria-invalid={error?.field === 'weightKg' ? 'true' : undefined}
				class="input mt-1 w-24 font-mono tabular-nums"
			/>
		</label>
		<button onclick={save} disabled={saving} class="btn btn-primary mb-0.5"
			>Save</button
		>
	</div>
	{#if error}
		<p class="text-danger mt-2 text-xs" role="alert">{error.message}</p>
	{/if}
</div>
