<script lang="ts">
	// The crew's settings (#1237), laid out like a room's: what it is called
	// and what it looks like. Owner and admins; a member who lands here is
	// told where the roster is. The invite is not here: it is every member's
	// to share, so its one home is the crew page. Every control saves on
	// change — no form, no save button (the room settings' rule).
	import { goto } from '$app/navigation';
	import Banner from '$lib/components/Banner.svelte';
	import CrewMark from '$lib/components/CrewMark.svelte';
	import IconPicker from '$lib/components/IconPicker.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import {
		clearCrewImage,
		fetchCrew,
		renameCrew,
		setCrewImage,
		type Crew,
	} from '$lib/crew';
	import { presence } from '$lib/presence.svelte';
	import { toasts } from '$lib/toast.svelte';
	import { untrack } from 'svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let crew = $state<Crew | null>(untrack(() => data.crew));
	let error = $state<string | null>(untrack(() => data.error));
	let busy = $state(false);
	let name = $state(untrack(() => data.crew?.name ?? ''));
	// The browser caches the picture's URL; a bump after each change makes
	// the preview here reflect the upload without a reload.
	let bump = $state(0);

	const administers = $derived(
		crew?.role === 'owner' || crew?.role === 'admin',
	);

	async function reload() {
		if (!crew) return;
		const res = await fetchCrew(crew.id);
		if (res.ok) {
			crew = res.data;
			name = res.data.name;
		}
		presence.reload();
	}

	async function saveName() {
		const next = name.trim();
		if (!crew || !next || next === crew.name) return;
		busy = true;
		const res = await renameCrew(crew.id, next);
		busy = false;
		if (!res.ok) {
			toasts.push(res.error.message, { tone: 'error' });
			name = crew.name;
			return;
		}
		await reload();
	}

	async function pickIcon(key: string) {
		if (!crew) return;
		busy = true;
		const res = await renameCrew(crew.id, crew.name, key);
		busy = false;
		if (!res.ok) {
			toasts.push(res.error.message, { tone: 'error' });
			return;
		}
		await reload();
	}

	async function pickImage(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!crew || !file) return;
		busy = true;
		const res = await setCrewImage(crew.id, file);
		busy = false;
		if (!res.ok) {
			toasts.push(res.error.message, { tone: 'error' });
			return;
		}
		bump += 1;
		await reload();
	}

	async function removeImage() {
		if (!crew) return;
		busy = true;
		const res = await clearCrewImage(crew.id);
		busy = false;
		if (!res.ok) {
			toasts.push(res.error.message, { tone: 'error' });
			return;
		}
		bump += 1;
		await reload();
	}
</script>

<svelte:head>
	<title>{crew ? `${crew.name} · settings` : 'Crew settings'} · WattRoom</title>
</svelte:head>

<main class="page">
	{#if error}
		<Banner>{error}</Banner>
	{:else if !crew}
		<Skeleton class="h-8 w-48" />
		<Skeleton class="mt-6 h-40" />
	{:else if !administers}
		<!-- Capability gating (ux.md): a member gets the one line and the way
		     back, never a page of controls that refuse. -->
		<h1 class="font-display text-xl font-bold">{crew.name}</h1>
		<p class="text-muted mt-2 text-sm">
			The crew's settings are its owner's and admins'. <a
				href="/crew/{crew.id}"
				class="underline">Back to the crew</a
			>.
		</p>
	{:else}
		<header class="flex items-baseline gap-3">
			<h1 class="font-display text-xl font-bold">Crew settings</h1>
			<a
				href="/crew/{crew.id}"
				class="text-muted hover:text-ink text-xs underline">{crew.name}</a
			>
		</header>

		<section class="panel mt-5 p-6">
			<label class="block">
				<span class="eyebrow">crew name</span>
				<input
					bind:value={name}
					onchange={saveName}
					disabled={busy}
					maxlength="60"
					class="input mt-1 w-full"
				/>
			</label>

			<div class="mt-5">
				<span class="eyebrow" id="crew-picture-label">picture</span>
				<div class="mt-2 flex flex-wrap items-center gap-4">
					{#key bump}
						<CrewMark
							name={crew.name}
							icon={crew.icon}
							imageUrl={crew.imageUrl
								? `${crew.imageUrl}?v=${bump}`
								: undefined}
							size={64}
							class="rounded-xl"
						/>
					{/key}
					<div class="flex flex-wrap items-center gap-2">
						<label class="btn btn-secondary btn-xs cursor-pointer">
							{crew.imageUrl ? 'Replace picture' : 'Upload a picture'}
							<input
								type="file"
								accept="image/png,image/jpeg,image/gif,image/webp"
								onchange={pickImage}
								disabled={busy}
								class="sr-only"
								aria-labelledby="crew-picture-label"
							/>
						</label>
						{#if crew.imageUrl}
							<button
								onclick={removeImage}
								disabled={busy}
								class="btn btn-ghost btn-xs">Remove</button
							>
						{/if}
					</div>
				</div>
				<span class="text-muted mt-1.5 block text-xs"
					>Up to 2 MB. Shown in the sidebar, on the crew's page and at its door.
					Without one, the icon below stands in.</span
				>
			</div>

			<div class="mt-5">
				<span class="eyebrow" id="crew-icon-label">icon</span>
				<div class="mt-1.5">
					<IconPicker
						value={crew.icon ?? ''}
						onpick={pickIcon}
						disabled={busy}
						labelledby="crew-icon-label"
					/>
				</div>
			</div>
		</section>

		<p class="text-muted mt-6 text-xs">
			The invite, admins, bans and handing the crew on live on <a
				href="/crew/{crew.id}"
				class="underline">the crew's page</a
			>.
		</p>
		{#if crew.role === 'owner'}
			<p class="text-muted mt-1 text-xs">
				A crew is never deleted by hand: one with nobody left in it goes on its
				own.
			</p>
		{/if}
		<button
			onclick={() => goto(`/crew/${crew?.id}`)}
			class="btn btn-secondary btn-xs mt-4">Back to the crew</button
		>
	{/if}
</main>
