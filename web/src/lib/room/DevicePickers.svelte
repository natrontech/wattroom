<script lang="ts">
	// The three device selects (#1858): /settings/voice draws them with and
	// without a room, and the room's Sound panel draws them too (#1883). One
	// component, so the two never disagree on what an unnamed device is called.
	import Select from '$lib/components/Select.svelte';
	import { deviceOptions } from '$lib/room/device-options';

	let {
		devices = { mics: [], cams: [], outs: [] },
		micId = '',
		camId = '',
		outId = '',
		canPickOutput = false,
		onDevice,
		onName,
	}: {
		devices?: {
			mics: { deviceId: string; label: string }[];
			cams: { deviceId: string; label: string }[];
			outs: { deviceId: string; label: string }[];
		};
		micId?: string;
		camId?: string;
		outId?: string;
		canPickOutput?: boolean;
		onDevice?: (kind: 'mic' | 'cam' | 'out', id: string) => void;
		/** With no room there is no mic test or join to name the devices; this
		 * grants the mic once so the names show. */
		onName?: () => void;
	} = $props();
</script>

<div class="grid gap-4 sm:grid-cols-3">
	<label class="block">
		<span class="eyebrow">microphone</span>
		<div class="mt-1">
			<Select
				label="Microphone"
				value={micId}
				options={deviceOptions(devices.mics, 'Microphone')}
				onchange={(id) => onDevice?.('mic', id)}
			/>
		</div>
	</label>
	<label class="block">
		<span class="eyebrow">camera</span>
		<div class="mt-1">
			<Select
				label="Camera"
				value={camId}
				options={deviceOptions(devices.cams, 'Camera')}
				onchange={(id) => onDevice?.('cam', id)}
			/>
		</div>
	</label>
	{#if canPickOutput}
		<label class="block">
			<span class="eyebrow">speakers · voice only</span>
			<div class="mt-1">
				<Select
					label="Speakers"
					value={outId}
					options={deviceOptions(devices.outs, 'Speakers')}
					onchange={(id) => onDevice?.('out', id)}
				/>
			</div>
		</label>
	{/if}
</div>
{#if devices.mics.length > 0 && !devices.mics.some((d) => d.label)}
	<p class="text-muted-dim mt-2 text-[11px]">
		{#if onName}
			Names appear once the browser grants the mic —
			<button type="button" class="btn-link" onclick={onName}
				>name them now</button
			>.
		{:else}
			Names appear once a mic test or a voice join grants mic access.
		{/if}
	</p>
{/if}
