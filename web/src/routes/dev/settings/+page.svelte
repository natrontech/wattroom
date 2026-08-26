<script lang="ts">
	import { play } from '$lib/sound/cues';
	import { ROOM_NAME } from '../room/mockRoom.svelte';

	// docs/SPEC.md roles matrix: editing the room and assigning coach are owner-only.
	let name = $state(ROOM_NAME);
	let listed = $state(false);
	let pack = $state('base');
	let confirmDelete = $state(false);

	const members = [
		{ name: 'You', role: 'owner' },
		{ name: 'Nina', role: 'coach' },
		{ name: 'Ruben', role: 'member' },
		{ name: 'Milo', role: 'member' },
		{ name: 'Sara', role: 'member' },
		{ name: 'Tobi', role: 'member' },
	];

	// Packs are parameter sets, not downloads — custom ones are a fast-follow (WATTROOM.md).
	const packs = [
		{
			id: 'base',
			label: 'Base',
			hint: 'The synthwave set. Ships with every room.',
		},
		{
			id: 'silent',
			label: 'Silent',
			hint: 'Visual cues only. Voice stays on.',
		},
	];
</script>

<main class="mx-auto max-w-2xl px-6 py-10">
	<h1 class="font-display text-3xl font-bold tracking-tight">Room settings</h1>
	<p class="text-muted mt-2 text-sm">
		Owner only — coaches run sessions, owners shape the room.
	</p>

	<section class="border-muted/15 bg-surface-raised mt-8 rounded-lg border p-6">
		<label class="block">
			<span class="text-muted text-[10px] tracking-wider uppercase"
				>room name</span
			>
			<input
				bind:value={name}
				class="border-muted/25 mt-1 w-full rounded border bg-transparent px-3 py-2 text-sm"
			/>
		</label>

		<label class="mt-5 flex items-start gap-3">
			<input type="checkbox" bind:checked={listed} class="mt-0.5" />
			<span>
				<span class="block text-sm">List this room publicly</span>
				<span class="text-muted block text-xs">
					Off by default. Listing shows the name and rider count — metrics stay
					visible only to people who actually join.
				</span>
			</span>
		</label>
	</section>

	<section class="border-muted/15 bg-surface-raised mt-3 rounded-lg border p-6">
		<h2 class="font-display font-bold">Sound pack</h2>
		<div class="mt-3 grid gap-2">
			{#each packs as option (option.id)}
				<label
					class="flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 {pack ===
					option.id
						? 'border-white/40'
						: 'border-muted/15'}"
				>
					<input type="radio" bind:group={pack} value={option.id} />
					<span class="min-w-0">
						<span class="block text-sm font-medium">{option.label}</span>
						<span class="text-muted block text-xs">{option.hint}</span>
					</span>
					{#if option.id !== 'silent'}
						<button
							onclick={(event) => (event.preventDefault(), play('fanfare'))}
							class="border-muted/25 hover:border-muted/60 ml-auto shrink-0 rounded border px-3 py-1.5 text-xs"
							>Preview</button
						>
					{/if}
				</label>
			{/each}
		</div>
		<p class="text-muted mt-3 text-xs">
			Custom packs — insider memes, your own klaxon — are a fast-follow.
		</p>
	</section>

	<section class="border-muted/15 bg-surface-raised mt-3 rounded-lg border p-6">
		<h2 class="font-display font-bold">Who's in here</h2>
		<ul class="mt-3 divide-y divide-white/5">
			{#each members as member (member.name)}
				<li class="flex items-center gap-3 py-2.5">
					<span class="text-sm">{member.name}</span>
					<span class="text-muted text-[10px] tracking-wider uppercase"
						>{member.role}</span
					>
					{#if member.role !== 'owner'}
						<button
							class="border-muted/25 hover:border-muted/60 ml-auto rounded border px-3 py-1.5 text-xs"
							>{member.role === 'coach' ? 'Remove coach' : 'Make coach'}</button
						>
					{/if}
				</li>
			{/each}
		</ul>
		<p class="text-muted mt-3 text-xs">
			Coaches pick the workout, start the countdown, and can pause or end a
			session.
		</p>
	</section>

	<section class="border-muted/15 mt-3 rounded-lg border p-6">
		<h2 class="font-display font-bold">Delete room</h2>
		<p class="text-muted mt-1.5 text-xs">
			Removes the room, its medal history and its streak for everyone in it.
			Rides already ridden stay in each rider's own history.
		</p>
		{#if confirmDelete}
			<div class="border-z6/50 bg-z6/10 mt-4 rounded-lg border p-4">
				<p class="text-xs">
					Delete “{name}” for all 6 members? This can't be undone.
				</p>
				<div class="mt-3 flex gap-2">
					<button
						class="bg-z6 rounded px-4 py-2 text-sm font-semibold text-white"
						>Delete room</button
					>
					<button
						onclick={() => (confirmDelete = false)}
						class="border-muted/30 rounded border px-4 py-2 text-sm"
						>Cancel</button
					>
				</div>
			</div>
		{:else}
			<button
				onclick={() => (confirmDelete = true)}
				class="border-z6/40 text-z6 hover:bg-z6/10 mt-4 rounded border px-4 py-2 text-sm"
				>Delete room</button
			>
		{/if}
	</section>
</main>
