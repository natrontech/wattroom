<script lang="ts">
	/**
	 * The pads themselves — face 1 of the board panel (#981).
	 *
	 * A pad's face is its own waveform, so a sound is found by silhouette at
	 * arm's length rather than read. Idle is violet and flat because chrome
	 * never glows; the part that has already played takes the live hue,
	 * because that is what ADR-0005 reserves it for.
	 *
	 * The pad is the one object a rider actually touches mid-ride, and it was
	 * the only thing in the feature with no menu (#981, ux.md). The primary
	 * action stays on click — nothing below is reachable ONLY from the menu.
	 */
	import { Pause, Play, Plus } from '@lucide/svelte';
	import {
		contextMenu,
		MENU_HINT,
		type MenuEntry,
	} from '$lib/context-menu.svelte';
	import {
		board,
		movePad,
		remove,
		rename,
		type Clip,
	} from '$lib/board/clips.svelte';
	import { boardPanel } from '$lib/board/panel.svelte';
	import { learn, shapeOf } from '$lib/board/shapes.svelte';
	import { previewing } from '$lib/sound/board.svelte';

	let {
		mine,
		onPress,
		onAudition,
	}: {
		/** The pad this rider has sounding, so only their own press lights up. */
		mine: number | undefined;
		/** `alt` is the audition: only this rider hears it (#981). */
		onPress: (pad: number, alt: boolean) => void;
		onAudition: (clip: Clip) => void;
	} = $props();

	/** Which clip's name is being typed over, and what has been typed. */
	let renaming = $state<string | null>(null);
	let draft = $state('');
	let refusal = $state<string | undefined>();
	/** Which pad is being dragged, and which one it is hovering. */
	let dragged = $state<number | null>(null);
	let over = $state<number | null>(null);
	/** The clip a confirm is standing over — a delete is not undoable. */
	let deleting = $state<Clip | null>(null);

	const pads = $derived(
		Array.from({ length: board.padCount }, (_, i) => ({
			slot: i + 1,
			clip: board.onPad(i + 1),
		})),
	);

	// The real envelope once the audio has been decoded for playback, the
	// id-derived shape until then — the pad never waits to draw.
	function bars(clip: Clip) {
		learn(clip.id, 20);
		return shapeOf(clip.id, 20);
	}

	function startRename(clip: Clip) {
		renaming = clip.id;
		draft = clip.name;
		refusal = undefined;
	}

	async function commitRename(clip: Clip) {
		const wanted = draft.trim();
		renaming = null;
		if (!wanted || wanted === clip.name) return;
		refusal = (await rename(clip.id, wanted))?.message;
	}

	function padMenu(slot: number, clip: Clip): MenuEntry[] {
		const sounding = previewing() === clip.id;
		return [
			{
				label: sounding ? 'Stop the preview' : 'Preview',
				hint: 'only you',
				icon: sounding ? Pause : Play,
				onSelect: () => onAudition(clip),
			},
			{ label: 'Trim…', onSelect: () => boardPanel.trim(clip.id) },
			{
				label: 'Change key',
				hint: clip.key?.toUpperCase(),
				onSelect: () => boardPanel.go('clips'),
			},
			{ label: 'Rename…', onSelect: () => startRename(clip) },
			'separator',
			{
				label: 'Take off the board',
				onSelect: () => void movePad(clip.id, null),
			},
			'separator',
			{
				label: 'Delete clip',
				danger: true,
				onSelect: () => (deleting = clip),
			},
		];
	}

	/** Drop one pad on another: empty target moves, occupied target swaps. */
	function drop(target: number) {
		const from = dragged;
		dragged = null;
		over = null;
		if (from === null || from === target) return;
		const moving = board.onPad(from);
		if (moving) void movePad(moving.id, target);
	}
</script>

<div
	class="grid max-h-[min(60vh,32rem)] grid-cols-3 gap-2 overflow-y-auto px-0.5"
>
	{#each pads as { slot, clip } (slot)}
		{@const playing = mine === slot}
		{@const target = over === slot && dragged !== slot}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			role="presentation"
			ondragover={(e) => {
				e.preventDefault();
				over = slot;
			}}
			ondragleave={() => {
				if (over === slot) over = null;
			}}
			ondrop={(e) => {
				e.preventDefault();
				drop(slot);
			}}
		>
			<button
				draggable={clip ? true : undefined}
				ondragstart={() => (dragged = slot)}
				ondragend={() => {
					dragged = null;
					over = null;
				}}
				onclick={(e) => onPress(slot, e.altKey)}
				title={clip
					? `${clip.name}${clip.key ? ` — key ${clip.key.toUpperCase()}` : ''} · alt-click to hear it yourself · ${MENU_HINT}`
					: `Pad ${slot} is empty — add a clip`}
				class="relative flex h-23 w-full flex-col gap-1 overflow-hidden rounded border p-2 text-left {target
					? 'border-neon border-dashed'
					: clip
						? playing
							? 'border-watt/50 bg-watt/8'
							: 'border-muted/20 bg-surface-raised hover:border-muted/40'
						: 'border-muted/20 border-dashed'} {dragged === slot
					? 'opacity-40'
					: ''}"
				{@attach clip ? contextMenu(() => padMenu(slot, clip)) : () => {}}
			>
				{#if clip}
					<span class="flex items-start">
						<span class="flex-1"></span>
						<!-- Only a pad a key actually fires wears one. A badge on
						     pad 10 would draw a shortcut that does nothing, and a
						     control that does something else than it draws is not
						     a control (ux.md). -->
						{#if clip.key}
							<span
								class="font-display rounded-[3px] border px-1.5 py-0.5 text-[10px] leading-none {playing
									? 'border-watt/40 text-watt'
									: 'border-muted/25 text-muted'} uppercase">{clip.key}</span
							>
						{/if}
					</span>
					<span class="flex flex-1 items-center">
						<svg
							viewBox="0 0 104 34"
							width="100%"
							height="34"
							preserveAspectRatio="none"
							aria-hidden="true"
						>
							<g class={playing ? 'text-watt glow-stroke' : 'text-neon/55'}>
								{#each bars(clip) as bar, i (i)}
									<rect
										x={bar.x}
										y={bar.y}
										width="3"
										height={bar.h}
										rx="1.5"
										fill="currentColor"
									/>
								{/each}
							</g>
						</svg>
					</span>
					{#if renaming === clip.id}
						<!-- svelte-ignore a11y_autofocus -->
						<input
							bind:value={draft}
							autofocus
							onclick={(e) => e.stopPropagation()}
							onkeydown={(e) => {
								e.stopPropagation();
								if (e.key === 'Enter') void commitRename(clip);
								if (e.key === 'Escape') renaming = null;
							}}
							onblur={() => void commitRename(clip)}
							aria-label="rename {clip.name}"
							class="input input-xs w-full text-[11px]"
						/>
					{:else}
						<span
							class="truncate text-[11px] leading-tight {playing
								? 'font-medium'
								: 'text-ink/85'}">{clip.name}</span
						>
					{/if}
				{:else}
					<span
						class="text-muted/55 absolute inset-0 flex flex-col items-center justify-center gap-1"
					>
						<Plus size={16} />
						<span class="text-[10px]">empty</span>
					</span>
				{/if}
			</button>
		</div>
	{/each}
</div>

{#if refusal}
	<p class="text-danger px-1.5 pt-1.5 text-[11px]">{refusal}</p>
{/if}

{#if deleting}
	<!-- A confirm, not the undo toast errors.md prefers: the audio goes with
	     the row and the browser never kept the file, so there is nothing to
	     put back (see `remove` in clips.svelte). -->
	<div
		class="border-danger/40 mt-1.5 rounded border px-2 py-2 text-[11px]"
		role="alertdialog"
		aria-label="delete {deleting.name}"
	>
		<p>
			Delete <span class="font-display">{deleting.name}</span>? The audio goes
			with it — this cannot be undone.
		</p>
		<div class="mt-1.5 flex items-center gap-2">
			<span class="flex-1"></span>
			<button onclick={() => (deleting = null)} class="btn btn-ghost btn-xs"
				>Keep it</button
			>
			<button
				onclick={() => {
					const gone = deleting;
					deleting = null;
					if (gone) void remove(gone.id);
				}}
				class="btn btn-danger btn-xs">Delete</button
			>
		</div>
	</div>
{/if}
