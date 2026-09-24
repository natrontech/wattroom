<script lang="ts">
	import FileUp from '@lucide/svelte/icons/file-up';
	import Info from '@lucide/svelte/icons/info';
	import { goto } from '$app/navigation';
	import { account } from '$lib/account.svelte';
	import Banner from '$lib/components/Banner.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import WorkoutPreview from '$lib/components/WorkoutPreview.svelte';
	import { fileDrop } from '$lib/file-drop.svelte';
	import { formatClock } from '$lib/format';
	import { toasts } from '$lib/toast.svelte';
	import { customWorkouts } from '$lib/workout/custom.svelte';
	import { durationSeconds, flatten } from '$lib/workout/engine';
	import {
		IMPORT_EXTENSIONS,
		importWorkoutFile,
		type Imported,
	} from '$lib/workout/import';

	/**
	 * Bringing a plan in from somewhere else (#2327). The rider already has
	 * the file; the conversion runs here in their browser and the result is
	 * an ordinary WattRoom workout, saved through the same endpoint the
	 * editor's Save uses.
	 *
	 * The preview is the point: a converted file has lost whatever our steps
	 * cannot say, and this is where that gets read before anything is stored.
	 */

	const custom = customWorkouts();

	// The preview scales to the rider's own FTP, like the shelf and the editor
	// (#1003); 265 only covers the flicker before `me` lands. The CONVERSION
	// gets the real number or nothing — an .erg ramping in watts is written
	// into the saved workout at whatever FTP it is converted at, and a
	// stand-in there would be a number nobody chose.
	const previewFtp = $derived(account.me?.ftpWatts || 265);
	const riderFtp = $derived(account.me?.ftpWatts || null);

	let reading = $state(false);
	let error = $state<string | null>(null);
	let imported = $state<Imported | null>(null);
	let fileName = $state('');
	let saving = $state(false);
	// A save the server refused (#2627) is not a file that cannot be read: it
	// keeps the preview and its Save row, and offers the same save again.
	let saveError = $state<string | null>(null);
	let savedAndEdit = false;

	const segments = $derived(imported ? flatten(imported.workout) : []);
	const total = $derived(imported ? durationSeconds(imported.workout) : 0);
	// Nothing picked yet: the empty state draws its own dashed box, so the
	// drop surface around it stays invisible until a drag lights it up.
	const idle = $derived(!reading && !imported && !error);

	// Never render a button that will fail (errors.md): a new workout on a
	// full shelf is a 429, and a shelf that could not be read at all must not
	// be saved onto blind.
	const blocked = $derived(
		custom.error
			? 'Your shelf could not be read, so nothing can be saved onto it yet.'
			: custom.full
				? `${custom.max} workouts — your shelf is full. Delete one to make room.`
				: null,
	);

	async function take(files: FileList) {
		const file = files[0];
		if (!file) return;
		reading = true;
		error = null;
		saveError = null;
		imported = null;
		fileName = file.name;
		const outcome = await importWorkoutFile(file, riderFtp);
		reading = false;
		if (outcome.ok) imported = outcome.imported;
		else error = outcome.error;
	}

	const drop = fileDrop((files) => void take(files));

	let picker = $state<HTMLInputElement | null>(null);
	function pick(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		if (input.files) void take(input.files);
		// Cleared so picking the same file twice still fires a change.
		input.value = '';
	}

	async function save(andEdit: boolean) {
		if (!imported || blocked) return;
		saving = true;
		saveError = null;
		savedAndEdit = andEdit;
		const result = await custom.save($state.snapshot(imported.workout));
		saving = false;
		if (result.error) {
			saveError = result.error;
			return;
		}
		toasts.push(`Imported “${imported.workout.name}” onto your shelf.`);
		await goto(andEdit ? `/workouts/edit?w=${result.id}` : '/workouts');
	}
</script>

<svelte:head><title>Import a workout · WattRoom</title></svelte:head>

<main class="page">
	<h1 class="page-title">Import a workout</h1>
	<p class="text-muted mt-1 text-xs">
		A Zwift <code>.zwo</code> or a <code>.erg</code> course file becomes a WattRoom
		workout on your shelf. It stays yours — importing shares nothing.
	</p>

	<input
		bind:this={picker}
		type="file"
		accept={IMPORT_EXTENSIONS.join(',')}
		onchange={pick}
		class="sr-only"
		aria-label="Choose a workout file"
	/>

	<section class="mt-6">
		<div
			{...drop.on}
			class="rounded-lg border border-dashed p-6 transition-colors {drop.over
				? 'border-neon bg-neon/5'
				: idle
					? 'border-transparent'
					: 'border-muted/25'}"
		>
			{#if reading}
				<!-- Reading is usually instant; a file on a slow volume is not. -->
				<Skeleton class="h-24" rows={2} />
			{:else if !imported && !error}
				<EmptyState>
					{#snippet icon()}<FileUp size={20} class="text-muted" />{/snippet}
					Drop a <code>.zwo</code> or <code>.erg</code> here, or choose one. You
					will see exactly what it became — and what it could not bring — before
					anything is saved.
					{#snippet cta()}
						<button
							onclick={() => picker?.click()}
							class="btn btn-primary btn-lg">Choose a file</button
						>
					{/snippet}
				</EmptyState>
			{:else}
				<div class="flex flex-wrap items-center gap-x-3 gap-y-2">
					<FileUp size={16} class="text-muted shrink-0" />
					<p class="min-w-0 flex-1 truncate font-mono text-xs">{fileName}</p>
					<button onclick={() => picker?.click()} class="btn btn-ghost btn-xs"
						>Choose another file</button
					>
				</div>

				{#if error}
					<!-- The refusal names what is wrong with the file, so it reads
					     here rather than as a toast that scrolls away. -->
					<div class="mt-3">
						<Banner tone="error">{error}</Banner>
					</div>
				{:else if imported}
					<div class="mt-4">
						<div
							class="border-muted/15 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b pb-2"
						>
							<h2 class="font-display min-w-0 truncate text-base font-bold">
								{imported.workout.name}
							</h2>
							<span class="text-muted ml-auto font-mono text-xs tabular-nums"
								>{formatClock(total)}</span
							>
						</div>
						<div class="mt-3">
							<WorkoutPreview {segments} ftp={previewFtp} />
						</div>
					</div>

					{#if imported.notes.length > 0}
						<!-- "Imported" over a file that lost half its blocks is the
						     same bug as "Something went wrong" (errors.md). -->
						<div class="mt-4">
							<h3 class="eyebrow">what the file could not bring</h3>
							<ul class="mt-2 space-y-1.5">
								{#each imported.notes as note (note)}
									<li class="text-muted flex gap-2 text-xs">
										<Info size={14} class="mt-px shrink-0" />
										<span>{note}</span>
									</li>
								{/each}
							</ul>
						</div>
					{:else}
						<p class="text-muted mt-4 text-xs">
							Everything in that file came across.
						</p>
					{/if}

					{#if saveError}
						<!-- Atop the form it failed to submit (errors.md). -->
						<div class="mt-5">
							<Banner tone="error">
								{saveError}
								{#snippet action()}
									<button
										onclick={() => void save(savedAndEdit)}
										disabled={saving}
										class="btn-link text-xs">Try again</button
									>
								{/snippet}
							</Banner>
						</div>
					{/if}
					<div class="mt-5 flex flex-wrap items-center gap-3">
						<button
							onclick={() => void save(false)}
							disabled={saving || blocked !== null}
							class="btn btn-primary btn-lg">Save to my shelf</button
						>
						<button
							onclick={() => void save(true)}
							disabled={saving || blocked !== null}
							class="btn btn-ghost btn-lg">Save and edit</button
						>
						{#if blocked}
							<span class="text-muted text-xs">{blocked}</span>
						{/if}
					</div>
					{#if custom.error}
						<div class="mt-3">
							<Banner tone="error">
								{custom.error}
								{#snippet action()}
									<button
										onclick={() => void custom.retry()}
										class="btn-link text-xs">Retry</button
									>
								{/snippet}
							</Banner>
						</div>
					{/if}
				{/if}
			{/if}
		</div>
	</section>

	<p class="text-muted mt-6 text-xs">
		A converted workout is a WattRoom workout: every target scales to your FTP,
		and you can reshape it in the editor afterwards.
		<a href="/workouts" class="hover:text-ink underline">Back to workouts</a>
	</p>
</main>
