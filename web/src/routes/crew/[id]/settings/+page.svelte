<script lang="ts">
	// The crew's settings (#1237, #2454): what it is called and what it looks
	// like, its channels, its board, its listing and its reactions — all that
	// a room's own settings page held before the room dissolved into the crew
	// (ADR-0058). Owner and admins; a member who lands here is told where the
	// roster is. The invite is not here: it is every member's to share, so its
	// one home is the crew page. Every control saves on change — no form, no
	// save button.
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Banner from '$lib/components/Banner.svelte';
	import CrewMark from '$lib/components/CrewMark.svelte';
	import IconPicker from '$lib/components/IconPicker.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import {
		clearCrewImage,
		fetchCrew,
		updateCrew,
		setCrewImage,
		type Crew,
		rotateCrewCode,
	} from '$lib/crew';
	import { presence } from '$lib/presence.svelte';
	import { toasts } from '$lib/toast.svelte';
	import { untrack } from 'svelte';
	import type { PageData } from './$types';
	import { confirm } from '$lib/confirm.svelte';
	import CrewChannels from './CrewChannels.svelte';
	import CrewReactions from './CrewReactions.svelte';
	import CrewEmoji from './CrewEmoji.svelte';
	import { provideCrewEmoji } from '$lib/emoji/crew-emoji.svelte';

	let { data }: { data: PageData } = $props();
	let crew = $state<Crew | null>(untrack(() => data.crew));
	let error = $state<string | null>(untrack(() => data.error));
	let errorCode = $state<string | null>(untrack(() => data.errorCode));
	let busy = $state(false);
	let name = $state(untrack(() => data.crew?.name ?? ''));
	let nameError = $state<string | null>(null);
	// The browser caches the picture's URL; a bump after each change makes
	// the preview here reflect the upload without a reload.
	let bump = $state(0);

	provideCrewEmoji(() => crew?.id);

	const administers = $derived(
		crew?.role === 'owner' || crew?.role === 'admin',
	);

	// Calendars subscribed to a room's link went quiet when rooms became
	// channels (#2441): nothing tells a subscriber, so the people who share
	// the crew's link are told once, here (#2457). Per viewer, and an empty
	// or refused storage just shows it again — the worst case is one more read.
	const CALENDAR_MOVED = 'wattroom.calendarMoved.v1';
	let calendarNoticeSeen = $state(
		(() => {
			try {
				return localStorage.getItem(CALENDAR_MOVED) === '1';
			} catch {
				return false;
			}
		})(),
	);
	function dismissCalendarNotice() {
		calendarNoticeSeen = true;
		try {
			localStorage.setItem(CALENDAR_MOVED, '1');
		} catch {
			// Private window or blocked storage: it is only a notice.
		}
	}

	async function reload() {
		if (!crew) return;
		const res = await fetchCrew(crew.id);
		if (res.ok) {
			crew = res.data;
			name = res.data.name;
		}
		presence.reload();
	}

	// The first load failed: ask again, from the id in the address — there
	// is no crew to reload from yet (errors.md: error-with-retry).
	async function retry() {
		error = null;
		const res = await fetchCrew(page.params.id ?? '');
		if (!res.ok) {
			error = res.error.message;
			errorCode = res.error.error;
			return;
		}
		crew = res.data;
		name = res.data.name;
	}

	async function saveName() {
		const next = name.trim();
		nameError = null;
		if (!crew) return;
		if (!next) {
			// Said under the field, not swallowed: an emptied box used to
			// stay empty with no word on why nothing saved (audit 2026-09-09).
			nameError = 'A crew needs a name.';
			return;
		}
		if (next === crew.name) return;
		busy = true;
		const res = await updateCrew(crew.id, { name: next });
		busy = false;
		if (!res.ok) {
			toasts.push(res.error.message, { tone: 'error' });
			name = crew.name;
			return;
		}
		await reload();
	}

	// The crew's switches and palette, written whole with the name it has —
	// the typed one saves itself on change.
	let cheers = $state<string[]>([]);
	$effect(() => {
		// As stored (#2643): an emoji is a reaction of its own again, so one
		// from before #447 is no longer translated into the icon it resembled.
		cheers = crew?.cheers ?? [];
	});
	async function saveSettings(patch: {
		boardEnabled?: boolean;
		listed?: boolean;
		cheers?: string[];
	}) {
		if (!crew) return;
		busy = true;
		const res = await updateCrew(crew.id, { name: crew.name, ...patch });
		busy = false;
		if (!res.ok) toasts.push(res.error.message, { tone: 'error' });
		await reload();
	}

	async function pickIcon(key: string) {
		if (!crew) return;
		busy = true;
		// The name as typed, or an icon click would save the old one over it.
		const res = await updateCrew(crew.id, {
			name: name.trim() || crew.name,
			icon: key,
		});
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

	async function rotateCode() {
		if (!crew) return;
		const ok = await confirm({
			title: 'Make a new invite link?',
			body: 'The old link and code stop working the moment you do. Anyone you already shared it with needs the new one.',
			action: 'Make a new link',
			cancel: 'Keep it',
		});
		if (!ok) return;
		busy = true;
		const res = await rotateCrewCode(crew.id);
		busy = false;
		if (!res.ok) {
			toasts.push(res.error.message, { tone: 'error' });
			return;
		}
		toasts.push("New invite link — copy it from the crew's page.", {
			href: `/crew/${crew.id}`,
		});
		presence.reload();
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
	{#if error && errorCode === 'not_found'}
		<Banner tone="error">
			{error}
			{#snippet action()}
				<a href="/home" class="btn-link text-xs">Home</a>
			{/snippet}
		</Banner>
	{:else if error}
		<Banner tone="error">
			{error}
			{#snippet action()}
				<button onclick={() => void retry()} class="btn-link text-xs"
					>Retry</button
				>
			{/snippet}
		</Banner>
	{:else if !crew}
		<Skeleton class="h-8 w-48" />
		<Skeleton class="mt-6 h-40" />
	{:else if !administers}
		<!-- Capability gating (ux.md): a member gets the one line and the way
		     back, never a page of controls that refuse. -->
		<h1 class="page-title">{crew.name}</h1>
		<p class="text-muted mt-2 text-sm">
			The crew's settings are its owner's and admins'. <a
				href="/crew/{crew.id}"
				class="underline">Back to the crew</a
			>.
		</p>
		<!-- The one section every member may use (#2643): any of them adds an
		     emoji, so the list lives where each of them can reach it. -->
		<CrewEmoji crewId={crew.id} administers={false} />
	{:else}
		<header class="flex items-baseline gap-3">
			<h1 class="page-title">Crew settings</h1>
			<a
				href="/crew/{crew.id}"
				class="text-muted hover:text-ink text-xs underline">{crew.name}</a
			>
		</header>

		<section class="panel panel-xl mt-5">
			<label class="block">
				<span class="eyebrow">crew name</span>
				<input
					bind:value={name}
					onchange={saveName}
					disabled={busy}
					maxlength="60"
					aria-invalid={nameError ? 'true' : undefined}
					class="input mt-1 w-full"
				/>
				{#if nameError}<span class="text-danger mt-1 block text-xs"
						>{nameError}</span
					>{/if}
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

		<CrewChannels {crew} />

		<!-- Off is the default and turning it on is a deliberate act (ADR-0036,
		     amended by ADR-0058): being in a crew must not put a rider on a
		     board. The copy says what appears and to whom before it appears. -->
		<section class="panel panel-xl mt-5">
			<h2 class="font-display font-bold">Weekly board</h2>
			<p class="text-muted mt-1.5 text-xs">
				Off by default. Turned on, the crew's Members page ranks everyone's kJ
				and time for the current week, each beside riders of their own category.
				It starts fresh every Monday, never leaves the crew, and nothing is kept
				from week to week. The crew's invite link says so before anyone joins,
				and any rider can take themselves off it.
			</p>
			<label
				class="mt-3 flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 {crew.boardEnabled
					? 'border-ink/40'
					: 'border-muted/15'}"
			>
				<input
					type="checkbox"
					checked={!!crew.boardEnabled}
					aria-label="run the weekly board"
					onchange={() =>
						void saveSettings({ boardEnabled: !crew?.boardEnabled })}
					disabled={busy}
				/>
				<span class="text-sm font-medium"
					>{crew.boardEnabled ? 'Running' : 'Off'}</span
				>
			</label>
		</section>

		<!-- Finding is not joining and it is not reading (#1204): the listing
		     says what it publishes, including the half riders assume it does
		     not — the entry is a door. -->
		<section class="panel panel-xl mt-5">
			<h2 class="font-display font-bold">In the directory</h2>
			<p class="text-muted mt-1.5 text-xs">
				Off by default: the crew is invite-only. Listed, its name, picture and
				invite link are in the public crew directory, and anyone who finds it
				can walk in. What is said and ridden inside stays for the people in the
				crew.
			</p>
			<label
				class="mt-3 flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 {crew.listed
					? 'border-ink/40'
					: 'border-muted/15'}"
			>
				<input
					type="checkbox"
					checked={!!crew.listed}
					aria-label="list the crew in the directory"
					onchange={() => void saveSettings({ listed: !crew?.listed })}
					disabled={busy}
				/>
				<span class="text-sm font-medium"
					>{crew.listed ? 'Listed' : 'Invite-only'}</span
				>
			</label>
		</section>

		<CrewReactions
			bind:cheers
			crewId={crew.id}
			{busy}
			onchange={() => void saveSettings({ cheers })}
		/>
		<CrewEmoji crewId={crew.id} administers />

		{#if !calendarNoticeSeen}
			<div class="mt-5">
				<Banner tone="warn">
					Calendars subscribed to a room's link stopped updating when rooms
					became channels. The crew's own calendar link is on its <a
						href="/crew/{crew.id}/schedule"
						class="underline">Schedule</a
					>
					— share that one instead.
					{#snippet action()}
						<button onclick={dismissCalendarNotice} class="btn-link text-xs"
							>Got it</button
						>
					{/snippet}
				</Banner>
			</div>
		{/if}

		<!-- The invite's one home is the crew's page (ADR-0020); re-keying it
		     is a setting, and the one destructive one here — a confirm, since
		     there is no undo for a link already shared (errors.md). -->
		<section class="panel panel-xl mt-5">
			<span class="eyebrow">invite</span>
			<p class="text-muted mt-1 text-sm">
				The crew's code is its only door, and anyone in the crew may share it.
				If it got somewhere it should not have, make a new one: the old link
				stops working the moment you do.
			</p>
			<button
				onclick={() => void rotateCode()}
				disabled={busy}
				class="btn btn-secondary btn-xs mt-3">Make a new invite link</button
			>
		</section>

		<p class="text-muted mt-6 text-xs">
			The invite itself, admins, bans and handing the crew on live on <a
				href="/crew/{crew.id}"
				class="underline">the crew's page</a
			>.
		</p>
		{#if crew.role === 'owner'}
			<!-- Both halves of this line used to be wrong (#1935): a crew with
			     people in it passes to one of them rather than going with your
			     account, and one with nobody else in it goes with your account. -->
			<p class="text-muted mt-1 text-xs">
				A crew has no delete button. With people still in it, it passes to one
				of them — hand it on yourself, or your account's deletion does.
			</p>
		{/if}
		<button
			onclick={() => goto(`/crew/${crew?.id}`)}
			class="btn btn-secondary btn-xs mt-4">Back to the crew</button
		>
	{/if}
</main>
