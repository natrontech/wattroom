<script lang="ts">
	import Banner from '$lib/components/Banner.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import MedalCard from '$lib/components/MedalCard.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import ProgressBar from '$lib/components/ProgressBar.svelte';
	import PalettePicker from '$lib/components/PalettePicker.svelte';
	import { toasts } from '$lib/toast.svelte';
	import DeviceSlot from '$lib/components/DeviceSlot.svelte';
	import FaultBanner from '$lib/room/FaultBanner.svelte';
	import IntervalStrip from '$lib/room/IntervalStrip.svelte';
	import PlayerTile from '$lib/room/PlayerTile.svelte';
	import RiderTile from '$lib/room/RiderTile.svelte';
	import SprintMoment from '$lib/room/SprintMoment.svelte';
	import TargetWidget from '$lib/room/TargetWidget.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import ChatImage from '$lib/chat/ChatImage.svelte';
	import { Copy, SmilePlus } from '@lucide/svelte';
	import type { MockRider } from '../room/mockRoom.svelte';

	// A stand-in screenshot, deliberately bigger than any window: fit-to-window
	// and full size are two different pictures, which is the whole point of the
	// viewer (#510).
	const screenshot =
		'data:image/svg+xml;utf8,' +
		encodeURIComponent(
			`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000">
				<rect width="1600" height="1000" fill="#12121a"/>
				<rect x="60" y="60" width="1480" height="880" fill="#1b1b26" stroke="#8b5cf6" stroke-width="4"/>
				<text x="800" y="470" fill="#e879f9" font-family="monospace" font-size="72" text-anchor="middle">1600 × 1000</text>
				<text x="800" y="560" fill="#a1a1aa" font-family="monospace" font-size="36" text-anchor="middle">click to zoom · Esc to close</text>
			</svg>`,
		);

	// The sprint demos anchor to mount time so the first one runs its real
	// klaxon → window → podium lifecycle in front of you.
	const mountedAt = Date.now();
	let demoModal = $state(false);
	const podium = [
		{ riderId: 'ruben', name: 'Ruben', wkg: 14.3, watts: 1112 },
		{ riderId: 'sara', name: 'Sara', wkg: 12.6, watts: 830 },
		{ riderId: 'demo', name: 'You', wkg: 10.8, watts: 796 },
	];

	// Frozen sample riders: a gallery should not move while you read it.
	function rider(over: Partial<MockRider> = {}): MockRider {
		return {
			id: 'sara',
			name: 'Sara',
			ftp: 285,
			kg: 66,
			you: false,
			coach: false,
			cameraOn: true,
			muted: false,
			speaking: false,
			away: false,
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
		id: 'demo',
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
		{#each [{ label: 'riding', r: rider() }, { label: 'speaking', r: rider( { speaking: true } ) }, { label: 'away', r: rider( { away: true, cameraOn: false, watts: 0 } ) }, { label: 'no camera', r: rider( { name: 'Milo', cameraOn: false, muted: true, watts: 168, ftp: 195 } ) }, { label: 'signal lost', r: rider( { stale: true } ) }] as sample (sample.label)}
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
		Palette picker
	</h2>
	<div class="bg-surface-raised mt-4 rounded-lg p-5">
		<PalettePicker />
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
		<!-- Live lifecycle: counts down, runs the 15 s window, lands on the
		     podium — the real component, silenced for the gallery. -->
		<SprintMoment
			silent
			myWatts={743}
			sprint={{
				startsAtMs: mountedAt + 5_000,
				endsAtMs: mountedAt + 20_000,
				results: podium,
			}}
		/>
		<SprintMoment
			silent
			myWatts={0}
			sprint={{
				startsAtMs: mountedAt - 20_000,
				endsAtMs: mountedAt - 5_000,
				results: podium,
			}}
		/>
	</div>

	<h2 class="text-muted mt-12 text-xs tracking-[0.2em] uppercase">
		Banners, empty state, progress, modal, toasts
	</h2>
	<p class="text-muted mt-2 max-w-2xl text-xs">
		The behavior half of the kit. Banners for inline status (Retry goes in the
		action slot); EmptyState teaches; ProgressBar clamps; Modal traps focus and
		closes on Escape; toasts carry undo (errors.md: undo over confirm).
	</p>
	<div class="mt-4 grid gap-3">
		<Banner tone="error">
			The server did not answer properly.
			{#snippet action()}
				<button class="text-muted hover:text-ink text-xs underline"
					>Retry</button
				>
			{/snippet}
		</Banner>
		<Banner tone="warn">That saved workout was not found.</Banner>
		<Banner tone="ok">FTP saved — every workout now scales to 251 W.</Banner>
		<EmptyState>
			No rides yet — finish a workout and it lands here.
			{#snippet cta()}
				<span class="btn btn-primary">Pick a workout</span>
			{/snippet}
		</EmptyState>
		<div class="panel flex items-center gap-4 p-4">
			<ProgressBar pct={64} class="flex-1" />
			<ProgressBar pct={140} fill="bg-z4" class="flex-1" />
			<span class="text-muted text-[10px]">140% clamps to full</span>
		</div>
		<div class="flex gap-3">
			<button onclick={() => (demoModal = true)} class="btn btn-secondary"
				>Open modal</button
			>
			<button
				onclick={() => toasts.push('Ride exported.')}
				class="btn btn-secondary">Toast</button
			>
			<button
				onclick={() =>
					toasts.push('Deleted “Sweet Spot 2×20”.', { undo: () => {} })}
				class="btn btn-secondary">Undo toast</button
			>
		</div>
	</div>
	<h2 class="text-muted mt-12 text-xs tracking-[0.2em] uppercase">
		Chat image & viewer
	</h2>
	<p class="text-muted mt-2 max-w-2xl text-xs">
		A picture in a message is capped so it cannot push the conversation off
		screen. Clicking it opens the app's own viewer (#510) — never a browser tab,
		which takes the room with it. Click the picture again for full size, Escape
		or the backdrop to come back. Right-click the thumbnail for the new tab and
		the link, then whatever the message around it offers — the room panel passes
		its own message menu down, so reacting to a picture still works.
	</p>
	<div class="mt-4">
		<ChatImage
			src={screenshot}
			alt="Sent by Sara"
			menu={() => [
				{ label: 'React', icon: SmilePlus, onSelect: () => {} },
				{ label: 'Copy text', icon: Copy, onSelect: () => {} },
			]}
		/>
	</div>

	{#if demoModal}
		<Modal label="Demo modal" onclose={() => (demoModal = false)}>
			<p class="font-display font-bold">One modal, everywhere</p>
			<p class="text-muted mt-2 text-sm">
				Backdrop click and Escape close it; Tab stays inside.
			</p>
			<div class="mt-4 flex justify-end gap-2">
				<button onclick={() => (demoModal = false)} class="btn btn-secondary"
					>Close</button
				>
				<button onclick={() => (demoModal = false)} class="btn btn-primary"
					>Confirm</button
				>
			</div>
		</Modal>
	{/if}

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
		<FaultBanner
			fault={{ kind: 'voice', state: 'reconnecting' }}
			bufferedSeconds={0}
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
		<div class="border-danger/40 bg-danger/10 rounded-lg border p-4">
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
		<span class="text-ink">--color-neon</span>, because a checked box is chrome,
		not live data.
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
		<button class="bg-ink text-paper rounded px-4 py-2 text-sm font-medium"
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
