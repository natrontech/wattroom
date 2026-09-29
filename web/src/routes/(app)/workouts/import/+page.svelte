<script lang="ts">
	import FileUp from '@lucide/svelte/icons/file-up';
	import Info from '@lucide/svelte/icons/info';
	import { onMount } from 'svelte';
	import { goto, replaceState } from '$app/navigation';
	import { page } from '$app/state';
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
	import {
		importPlanned,
		intervalsAvailable,
		openPull,
		type PlannedWorkout,
	} from '$lib/workout/import/intervals';

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

	// The planned week from intervals.icu (#2327): offered only where the
	// server has a client (errors.md: never a button that fails), and opened
	// once, when the pull lands here.
	let offerPull = $state(false);
	type Pull =
		| { state: 'opening' }
		| { state: 'error'; error: string }
		| { state: 'open'; workouts: PlannedWorkout[]; skipped: number };
	let pull = $state<Pull | null>(null);
	let previewing = $state<number | null>(null);
	let saved = $state<number[]>([]);

	onMount(() => {
		void intervalsAvailable().then((yes) => (offerPull = yes));
		const landing = page.url.searchParams.get('intervals');
		if (!landing) return;
		// A reload must not ask again for a pull that is already spent.
		replaceState(page.url.pathname, {});
		pull = { state: 'opening' };
		void openPull(landing).then((result) => {
			pull = result.ok
				? { state: 'open', workouts: result.workouts, skipped: result.skipped }
				: { state: 'error', error: result.error };
		});
	});

	function preview(index: number) {
		if (pull?.state !== 'open') return;
		const planned = pull.workouts[index];
		error = null;
		saveError = null;
		fileName = `${planned.name || 'Planned workout'} · ${planned.date} · intervals.icu`;
		previewing = index;
		const outcome = importPlanned(planned, riderFtp);
		imported = outcome.ok ? outcome.imported : null;
		if (!outcome.ok) error = outcome.error;
	}

	const leftOut = (n: number) =>
		`${n} planned ${n === 1 ? 'item' : 'items'} had no workout file WattRoom can read, and ${n === 1 ? 'was' : 'were'} left out.`;

	async function take(files: FileList) {
		const file = files[0];
		if (!file) return;
		previewing = null;
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
		// A pulled week is several workouts: one saved keeps the rest in reach.
		if (previewing !== null && !andEdit) {
			saved = [...saved, previewing];
			previewing = null;
			imported = null;
			return;
		}
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

	{#if offerPull || pull}
		<section class="mt-6">
			<div class="flex flex-wrap items-center gap-3">
				<h2 class="eyebrow">from intervals.icu</h2>
				{#if offerPull}
					<!-- A full navigation: the pull is a round trip through
					     intervals.icu's consent page, not a route of this app. -->
					<a
						href="/api/intervals/start"
						data-sveltekit-reload
						class="btn btn-secondary ml-auto">Pull my planned workouts</a
					>
				{/if}
			</div>
			{#if !pull}
				<p class="text-muted mt-2 text-xs">
					The next seven days of your intervals.icu calendar, read once.
					WattRoom asks for planned workouts only, keeps no access to your
					account, and saves nothing until you choose.
				</p>
			{:else if pull.state === 'opening'}
				<Skeleton class="mt-3 h-16" rows={2} />
			{:else if pull.state === 'error'}
				<div class="mt-3">
					<Banner tone="error">
						{pull.error}
						{#snippet action()}
							{#if offerPull}
								<a
									href="/api/intervals/start"
									data-sveltekit-reload
									class="btn-link text-xs">Pull again</a
								>
							{/if}
						{/snippet}
					</Banner>
				</div>
			{:else if pull.workouts.length === 0}
				<p class="text-muted mt-3 text-xs">
					No planned workouts in the next seven days on intervals.icu.
					{#if pull.skipped > 0}{leftOut(pull.skipped)}{/if}
				</p>
			{:else}
				<ul class="border-frame mt-3 divide-y border-y">
					{#each pull.workouts as planned, index (index)}
						<li class="flex flex-wrap items-center gap-3 py-2">
							<span class="text-muted num text-xs">{planned.date}</span>
							<span class="min-w-0 flex-1 truncate text-sm"
								>{planned.name || 'Planned workout'}</span
							>
							{#if saved.includes(index)}
								<span class="text-ok text-xs">On your shelf</span>
							{:else}
								<button
									onclick={() => preview(index)}
									aria-pressed={previewing === index}
									class="btn btn-secondary btn-xs">Preview</button
								>
							{/if}
						</li>
					{/each}
				</ul>
				{#if pull.skipped > 0}
					<p class="text-muted mt-2 text-xs">{leftOut(pull.skipped)}</p>
				{/if}
			{/if}
		</section>
	{/if}

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
							class="border-frame flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b pb-2"
						>
							<h2 class="font-display min-w-0 truncate text-base font-bold">
								{imported.workout.name}
							</h2>
							<span class="text-muted num ml-auto text-xs"
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
