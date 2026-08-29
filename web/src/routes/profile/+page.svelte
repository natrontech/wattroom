<script lang="ts">
	import Logo from '$lib/brand/Logo.svelte';
	import { createProfileStore, PROFILE_LIMITS } from '$lib/profile.svelte';

	const profile = createProfileStore();
	let ftp = $state(profile.current.ftp);
	let kg = $state(profile.current.kg);
	let status = $state<string | null>(null);

	const measured = $derived(profile.current.ftpMeasuredAt);

	function save() {
		status = profile.update({ ftp, kg }) ?? 'Saved.';
	}
</script>

<main class="mx-auto max-w-md px-6 py-10">
	<div class="flex items-center gap-3">
		<Logo size={30} />
		<h1 class="font-display text-2xl leading-tight font-bold">Profile</h1>
	</div>
	<p class="text-muted mt-2 text-xs">
		Stored on this device until accounts land. Nothing here leaves your browser.
	</p>

	<div
		class="border-muted/15 bg-surface-raised mt-6 grid gap-5 rounded-lg border p-6"
	>
		<label class="block">
			<span class="text-muted text-[10px] tracking-wider uppercase"
				>FTP (watts)</span
			>
			<input
				type="number"
				bind:value={ftp}
				min={PROFILE_LIMITS.minFtp}
				max={PROFILE_LIMITS.maxFtp}
				class="border-muted/25 focus:border-muted/60 mt-1 w-full rounded border bg-transparent px-3 py-2 font-mono text-sm tabular-nums outline-none"
			/>
			<span class="text-muted mt-1 block text-[11px]">
				Every workout's targets scale to this.
				{#if measured}
					Measured by a ramp test on {new Date(measured).toLocaleDateString()}.
				{:else}
					<a href="/ramp" class="underline hover:text-white">Take a ramp test</a
					> to measure it.
				{/if}
			</span>
		</label>

		<label class="block">
			<span class="text-muted text-[10px] tracking-wider uppercase"
				>weight (kg)</span
			>
			<input
				type="number"
				bind:value={kg}
				min={PROFILE_LIMITS.minKg}
				max={PROFILE_LIMITS.maxKg}
				class="border-muted/25 focus:border-muted/60 mt-1 w-full rounded border bg-transparent px-3 py-2 font-mono text-sm tabular-nums outline-none"
			/>
			<span class="text-muted mt-1 block text-[11px]">
				Only used for w/kg — the number every contest here is scored on.
			</span>
		</label>

		<div class="flex items-center gap-3">
			<button
				onclick={save}
				class="rounded bg-white px-4 py-2 text-sm font-medium text-black hover:bg-white/90"
				>Save</button
			>
			{#if status}<span class="text-muted text-xs">{status}</span>{/if}
		</div>
	</div>
</main>
