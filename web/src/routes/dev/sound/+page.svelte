<script lang="ts">
	import {
		CUES,
		play,
		playCountdown,
		setDucked,
		setMuted,
		setVolume,
		type CueId,
	} from '$lib/sound/cues';

	let volume = $state(0.7);
	let muted = $state(false);
	let ducked = $state(false);
	let last = $state<CueId | 'sequence' | null>(null);

	$effect(() => setVolume(volume));
	$effect(() => setMuted(muted));
	$effect(() => setDucked(ducked));

	function fire(id: CueId) {
		last = id;
		play(id);
	}

	const ordered: CueId[] = [
		'countdown',
		'go',
		'klaxon',
		'elimination',
		'fanfare',
		'cheer',
		'reaction',
		'block',
	];
</script>

<main class="mx-auto max-w-3xl px-6 py-10">
	<h1 class="font-display text-3xl font-bold tracking-tight">Sound</h1>
	<p class="text-muted mt-2 max-w-2xl text-sm">
		Synthesised with Web Audio rather than sampled — synthwave is oscillators,
		filters and envelopes, so there is nothing to license, nothing to download,
		and a per-room pack becomes a parameter set rather than an asset bundle.
		Turn your volume up a little; these are mixed to sit under a voice.
	</p>

	<div
		class="border-muted/15 bg-surface-raised mt-6 flex flex-wrap items-center gap-6 rounded-lg border p-5"
	>
		<label class="flex items-center gap-3">
			<span class="text-muted text-[10px] tracking-wider uppercase">volume</span
			>
			<input type="range" min="0" max="1" step="0.05" bind:value={volume} />
			<span class="w-8 font-mono text-xs tabular-nums"
				>{Math.round(volume * 100)}</span
			>
		</label>
		<label class="text-muted flex items-center gap-2 text-xs">
			<input type="checkbox" bind:checked={muted} /> muted
		</label>
		<label class="text-muted flex items-center gap-2 text-xs">
			<input type="checkbox" bind:checked={ducked} /> someone is speaking
		</label>
	</div>
	<p class="text-muted mt-2 text-xs">
		Ducking pulls cues to 35 % rather than silencing them — a klaxon you miss
		because a friend was mid-sentence is a klaxon that failed.
	</p>

	<button
		onclick={() => ((last = 'sequence'), playCountdown())}
		class="mt-6 w-full rounded bg-white px-5 py-4 text-sm font-semibold text-black hover:bg-white/90"
		>Play the full 3 · 2 · 1 · go</button
	>

	<ul class="mt-3 grid gap-2">
		{#each ordered as id (id)}
			<li>
				<button
					onclick={() => fire(id)}
					class="border-muted/15 hover:border-muted/40 flex w-full items-center gap-4 rounded-lg border px-5 py-3.5 text-left {last ===
					id
						? 'bg-surface-raised'
						: ''}"
				>
					<span class="min-w-0 flex-1">
						<span class="block text-sm font-medium">{CUES[id].label}</span>
						<span class="text-muted block text-xs">{CUES[id].hint}</span>
					</span>
					<span class="text-muted shrink-0 font-mono text-[10px] tabular-nums"
						>{CUES[id].voices.length} voice{CUES[id].voices.length > 1
							? 's'
							: ''}</span
					>
				</button>
			</li>
		{/each}
	</ul>

	<div class="border-muted/15 mt-6 rounded-lg border p-5">
		<h2 class="font-display font-bold">Rules these follow</h2>
		<ul class="text-muted mt-3 space-y-1.5 text-xs leading-relaxed">
			<li>
				<span class="text-white">Mixed under voice.</span> Voice is the product; cues
				are furniture. They duck rather than stop, because ride-critical cues still
				have to land.
			</li>
			<li>
				<span class="text-white">Nothing loops.</span> Every cue is under a second.
				A rider is in the room for an hour — anything repetitive becomes torture.
			</li>
			<li>
				<span class="text-white">Reward is major, tension is minor.</span> The fanfare
				walks up a major triad; the elimination sting falls and closes a filter. That's
				the whole emotional vocabulary.
			</li>
			<li>
				<span class="text-white">Sound announces, never informs.</span> ux.md: state
				changes announce themselves because riders don't watch the screen. Nothing
				here is the only way to learn something.
			</li>
			<li>
				<span class="text-white">Jukebox audio is never touched.</span> It's local
				per rider and never enters the voice path (SPEC); these cues sit on their
				own bus.
			</li>
		</ul>
	</div>
</main>
