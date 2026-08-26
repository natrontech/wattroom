<script lang="ts">
	import MedalCard from '../medal/MedalCard.svelte';
	import DeviceSlot from '../pairing/DeviceSlot.svelte';
	import FaultBanner from '../room/FaultBanner.svelte';
	import IntervalStrip from '../room/IntervalStrip.svelte';
	import PlayerTile from '../room/PlayerTile.svelte';
	import RiderTile from '../room/RiderTile.svelte';
	import SprintMoment from '../room/SprintMoment.svelte';
	import TargetWidget from '../room/TargetWidget.svelte';
	import Skeleton from '../Skeleton.svelte';
	import type { MockRider } from '../room/mockRoom.svelte';

	// Frozen sample riders: a gallery should not move while you read it.
	function rider(over: Partial<MockRider> = {}): MockRider {
		return {
			name: 'Sara',
			ftp: 285,
			kg: 66,
			you: false,
			coach: false,
			cameraOn: true,
			muted: false,
			speaking: false,
			hue: 330,
			watts: 262,
			cadence: 91,
			hr: 158,
			stale: false,
			paused: false,
			lateJoined: false,
			target: 257,
			execution: 0.94,
			trace: [],
			...over,
		};
	}

	const you = rider({
		name: 'You',
		you: true,
		ftp: 265,
		kg: 74,
		watts: 242,
		target: 239,
	});

	const block = {
		index: 3,
		count: 6,
		label: 'Threshold',
		watts: 239,
		secondsLeft: 134,
		next: { label: 'Active recovery', watts: 146, seconds: 300 },
	};
</script>

<main class="mx-auto max-w-5xl px-6 py-12">
	<h1 class="font-display text-3xl font-bold tracking-tight">Components</h1>
	<p class="text-muted mt-2 max-w-2xl text-sm">
		The real components, not redrawn copies — this page imports the same files
		the screens do, so it can't drift from them. Tokens and the glow rules live
		in
		<a href="/dev/styleguide" class="underline">Styleguide</a>.
	</p>

	<h2 class="text-muted mt-12 text-xs tracking-[0.2em] uppercase">
		Rider tile
	</h2>
	<p class="text-muted mt-2 max-w-2xl text-xs">
		One object: camera, voice state and live power fused. Falls back to the mark
		when the camera is off, greys out when the trainer stops reporting.
	</p>
	<div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
		{#each [{ label: 'riding', r: rider() }, { label: 'speaking', r: rider( { speaking: true } ) }, { label: 'no camera', r: rider( { name: 'Milo', cameraOn: false, muted: true, watts: 168, ftp: 195 } ) }, { label: 'signal lost', r: rider( { stale: true } ) }] as sample (sample.label)}
			<div>
				<RiderTile rider={sample.r} phase="live" metrics={['hr']} />
				<p class="text-muted mt-1.5 text-[11px]">{sample.label}</p>
			</div>
		{/each}
	</div>

	<h2 class="text-muted mt-12 text-xs tracking-[0.2em] uppercase">
		Target — two distances
	</h2>
	<div class="mt-4 grid gap-4 lg:grid-cols-2">
		<div>
			<TargetWidget {you} variant="notch" />
			<p class="text-muted mt-1.5 text-[11px]">
				notch bar — arm's length, on the ride screen
			</p>
		</div>
		<div class="bg-surface-raised rounded-lg p-5">
			<TargetWidget {you} variant="delta" />
			<p class="text-muted mt-1.5 text-[11px]">delta — three metres, TV mode</p>
		</div>
	</div>

	<h2 class="text-muted mt-12 text-xs tracking-[0.2em] uppercase">
		Interval strip
	</h2>
	<div class="mt-4">
		<IntervalStrip {block} bias={1.02} onBias={() => {}} />
	</div>

	<h2 class="text-muted mt-12 text-xs tracking-[0.2em] uppercase">
		Sprint moment
	</h2>
	<div class="mt-4 grid gap-3">
		<SprintMoment state="armed" secondsLeft={3} riders={[]} podium={[]} />
		<SprintMoment
			state="podium"
			secondsLeft={0}
			riders={[]}
			podium={[
				{ name: 'Ruben', wkg: 14.3, watts: 1112, you: false },
				{ name: 'Sara', wkg: 12.6, watts: 830, you: false },
				{ name: 'You', wkg: 10.8, watts: 796, you: true },
			]}
		/>
	</div>

	<h2 class="text-muted mt-12 text-xs tracking-[0.2em] uppercase">
		Ride-critical faults
	</h2>
	<p class="text-muted mt-2 max-w-2xl text-xs">
		Persistent status, never a toast. Automatic recovery while it can; one big
		button when it can't.
	</p>
	<div class="mt-4 grid gap-3">
		<FaultBanner
			fault={{ kind: 'trainer', state: 'reconnecting' }}
			bufferedSeconds={0}
			onRecover={() => {}}
		/>
		<FaultBanner
			fault={{ kind: 'room', state: 'lost' }}
			bufferedSeconds={184}
			onRecover={() => {}}
		/>
	</div>

	<h2 class="text-muted mt-12 text-xs tracking-[0.2em] uppercase">
		Four page states
	</h2>
	<p class="text-muted mt-2 max-w-2xl text-xs">
		errors.md: every surface owes all four. A page that renders blank on failure
		is a bug.
	</p>
	<div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
		<div class="border-muted/15 rounded-lg border p-4">
			<Skeleton class="h-4 w-32" />
			<Skeleton class="mt-2 h-3 w-20" />
			<p class="text-muted mt-4 text-[11px]">loading</p>
		</div>
		<div class="border-z6/40 bg-z6/10 rounded-lg border p-4">
			<p class="text-sm">Couldn't load your rooms</p>
			<button class="border-muted/30 mt-3 rounded border px-3 py-1.5 text-xs"
				>Retry</button
			>
			<p class="text-muted mt-4 text-[11px]">error, with a way out</p>
		</div>
		<div class="border-muted/10 rounded-lg border border-dashed p-4">
			<p class="text-sm">No rooms yet.</p>
			<p class="text-muted mt-1 text-xs">Open one and your crew gets a ping.</p>
			<p class="text-muted mt-4 text-[11px]">empty, teaching</p>
		</div>
		<div class="border-muted/15 bg-surface-raised rounded-lg border p-4">
			<p class="font-display font-bold">Thursday Sufferfest</p>
			<p class="text-muted mt-1 text-xs">riding now · 6 in the room</p>
			<p class="text-muted mt-4 text-[11px]">content</p>
		</div>
	</div>

	<h2 class="text-muted mt-12 text-xs tracking-[0.2em] uppercase">
		Form controls
	</h2>
	<p class="text-muted mt-2 max-w-2xl text-xs">
		Native elements styled in place, not wrapped — they keep label association,
		keyboard behaviour and form semantics, and every call site gets them for
		free. They take
		<span class="text-white">--color-neon</span>, because a checked box is
		chrome, not live data.
	</p>
	<div
		class="border-muted/15 bg-surface-raised mt-4 grid gap-6 rounded-lg border p-6 sm:grid-cols-2"
	>
		<div class="space-y-3">
			<label class="flex items-center gap-3 text-sm"
				><input type="checkbox" checked /> Checked</label
			>
			<label class="flex items-center gap-3 text-sm"
				><input type="checkbox" /> Unchecked</label
			>
			<label class="text-muted flex items-center gap-3 text-sm"
				><input type="checkbox" disabled /> Disabled</label
			>
		</div>
		<div class="space-y-3">
			<label class="flex items-center gap-3 text-sm"
				><input type="radio" name="demo" checked /> Base pack</label
			>
			<label class="flex items-center gap-3 text-sm"
				><input type="radio" name="demo" /> Silent pack</label
			>
			<label class="text-muted flex items-center gap-3 text-sm"
				><input type="radio" name="demo2" disabled /> Disabled</label
			>
		</div>
		<label class="block">
			<span class="text-muted text-[10px] tracking-wider uppercase">range</span>
			<input type="range" class="mt-1 w-full" value="70" />
		</label>
		<label class="block">
			<span class="text-muted text-[10px] tracking-wider uppercase"
				>number, spinners removed</span
			>
			<input
				type="number"
				value="265"
				class="border-muted/25 mt-1 w-full rounded border bg-transparent px-3 py-2 font-mono text-sm tabular-nums"
			/>
		</label>
		<label class="block sm:col-span-2">
			<span class="text-muted text-[10px] tracking-wider uppercase"
				>text — select it to see ::selection</span
			>
			<input
				value="Thursday Sufferfest"
				class="border-muted/25 mt-1 w-full rounded border bg-transparent px-3 py-2 text-sm"
			/>
		</label>
		<div class="sm:col-span-2">
			<span class="text-muted text-[10px] tracking-wider uppercase"
				>scrollbar</span
			>
			<div
				class="border-muted/15 mt-1 h-24 overflow-y-auto rounded border p-3 text-xs"
			>
				{#each { length: 14 } as _, i (i)}
					<p class="text-muted py-0.5">
						Scroll me — the default is a grey stripe on near-black.
					</p>
				{/each}
			</div>
		</div>
	</div>

	<h2 class="text-muted mt-12 text-xs tracking-[0.2em] uppercase">
		Keyboard focus
	</h2>
	<p class="text-muted mt-2 max-w-2xl text-xs">
		Tab through these. The ring is white rather than an accent — it's chrome,
		and it has to win on any surface. Applied globally, so it can't be forgotten
		per component.
	</p>
	<div
		class="border-muted/15 bg-surface-raised mt-4 flex flex-wrap items-center gap-3 rounded-lg border p-6"
	>
		<button class="rounded bg-white px-4 py-2 text-sm font-medium text-black"
			>Primary</button
		>
		<button class="border-muted/30 rounded border px-4 py-2 text-sm"
			>Secondary</button
		>
		<button class="text-muted rounded px-4 py-2 text-sm">Ghost</button>
		<input
			class="border-muted/25 placeholder:text-muted/60 rounded border bg-transparent px-3 py-2 text-sm outline-none"
			placeholder="Room name"
		/>
		<a href="/dev/styleguide" class="text-sm underline">A link</a>
	</div>

	<h2 class="text-muted mt-12 text-xs tracking-[0.2em] uppercase">
		Media &amp; devices
	</h2>
	<div class="mt-4 grid gap-4 lg:grid-cols-[280px_1fr]">
		<PlayerTile />
		<div class="grid content-start gap-3">
			<DeviceSlot
				slot={{
					id: 'trainer',
					label: 'Smart trainer',
					need: 'Required to ride.',
					required: true,
					device: 'KICKR CORE 8F2A',
					protocol: 'FTMS · 0x1826',
				}}
				state="connected"
				supported={true}
				onPair={() => {}}
				onForget={() => {}}
			/>
			<DeviceSlot
				slot={{
					id: 'hr',
					label: 'Heart rate',
					need: 'Adds bpm to your tile and your .fit export.',
					required: false,
				}}
				state="failed"
				supported={true}
				onPair={() => {}}
				onForget={() => {}}
			/>
		</div>
	</div>

	<h2 class="text-muted mt-12 text-xs tracking-[0.2em] uppercase">
		Medal card
	</h2>
	<div class="mt-4">
		<MedalCard
			medal={{
				name: 'Metronome',
				criterion: 'best execution score',
				rider: 'Sara',
				value: '94',
				unit: '%',
				kj: 812,
				xp: 959,
			}}
		/>
	</div>
</main>
