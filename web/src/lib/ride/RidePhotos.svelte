<script lang="ts">
	/**
	 * The photos the rider took on this ride (docs/spec/riding.md "The
	 * ride's pictures"): Photo on the phone remote, the O key or a
	 * controller's snap, drawn as the world closed and kept with the ride.
	 * Each saves through the share sheet on a phone and as a download on a
	 * desk (share.ts). Absent on a ride with none.
	 */
	import { apiBlob } from '$lib/api';
	import {
		deletePhoto,
		listPhotos,
		photoFilename,
		photoUrl,
		type PhotoView,
		type RidePhoto,
	} from '$lib/ride/photos';
	import { shareFile } from '$lib/share';
	import { play } from '$lib/sound/cues';
	import { toasts } from '$lib/toast.svelte';
	import { CAMERA_NAMES } from '$lib/world/cameras';
	import ImageDown from '@lucide/svelte/icons/image-down';
	import Lock from '@lucide/svelte/icons/lock';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { tick } from 'svelte';

	let { id, startedAt }: { id: string; startedAt: string } = $props();

	// You on the road first: it is the photo, the view from above its companion.
	const VIEWS: PhotoView[] = ['world', 'overhead'];

	let photos = $state<RidePhoto[]>([]);
	let error = $state<string | null>(null);
	let busy = $state<string | null>(null);
	// Bumped when Undo puts a photo back, so its picture is read again.
	let fresh = $state(0);
	let section = $state<HTMLElement>();

	async function load() {
		const res = await listPhotos(id);
		if (!res.ok) {
			error = res.error.message;
			return;
		}
		error = null;
		photos = res.data;
		// The closing card links here by #photos; the list arrives after the page.
		if (photos.length > 0 && location.hash === '#photos') {
			await tick();
			section?.scrollIntoView({ block: 'start' });
		}
	}
	$effect(() => {
		void id;
		photos = [];
		void load();
	});

	async function save(photo: RidePhoto, view: PhotoView) {
		busy = `${photo.n}-${view}`;
		const res = await apiBlob(photoUrl(id, photo.n, view));
		if (res.ok)
			await shareFile(res.data.blob, photoFilename(startedAt, photo.n, view));
		else
			toasts.push(`That photo could not be saved. ${res.error.message}`, {
				tone: 'error',
			});
		busy = null;
	}

	async function remove(photo: RidePhoto) {
		busy = `${photo.n}-delete`;
		const res = await deletePhoto(id, photo);
		busy = null;
		if (!res.ok) {
			toasts.push(
				`Photo ${photo.n} could not be deleted. It is still there. ${res.error.message}`,
				{ tone: 'error' },
			);
			return;
		}
		photos = photos.filter((p) => p.n !== photo.n);
		play('leave');
		toasts.push(`Photo ${photo.n} deleted.`, {
			undo: () =>
				void res.data.restore().then((back) => {
					if (!back.ok) {
						toasts.push(
							`Photo ${photo.n} could not be put back. ${back.error.message}`,
							{ tone: 'error' },
						);
						return;
					}
					fresh++;
					void load();
				}),
		});
	}
</script>

{#if error}
	<p class="text-muted mt-3 text-xs">
		This ride's photos could not be loaded — {error}
		<button onclick={() => void load()} class="btn-link">Retry</button>
	</p>
{:else if photos.length > 0}
	<section
		id="photos"
		bind:this={section}
		class="panel panel-xl mt-6 scroll-mt-4"
		data-testid="ride-photos"
	>
		<h2 class="eyebrow">photos</h2>
		<p
			class="text-muted mt-0.5 mb-4 flex max-w-2xl items-center gap-1.5 text-xs"
		>
			<Lock size={12} class="shrink-0" />
			The ones you took on this ride. Only you see them, whatever the ride's sharing
			says.
		</p>
		<ul
			class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
		>
			{#each photos as photo (photo.n)}
				<li class="flex min-w-0 flex-col gap-2">
					{#if photo.views.includes('world')}
						<img
							src="{photoUrl(id, photo.n, 'world')}?v={fresh}"
							alt="Photo {photo.n}: you on the road"
							loading="lazy"
							width="1080"
							height="1350"
							class="bg-ink/5 aspect-[4/5] w-full rounded-md object-cover"
						/>
					{:else}
						<img
							src="{photoUrl(id, photo.n, 'overhead')}?v={fresh}"
							alt="Photo {photo.n}: the ride from above"
							loading="lazy"
							width="1350"
							height="1080"
							class="bg-ink/5 aspect-[4/5] w-full rounded-md object-cover"
						/>
					{/if}
					<!-- The picture's own Save across, then the view from above
					     and Delete under it: one row each fits a phone's column. -->
					<div class="grid grid-cols-[1fr_auto] gap-2">
						{#each VIEWS.filter( (v) => photo.views.includes(v) ) as view, i (view)}
							<button
								onclick={() => void save(photo, view)}
								disabled={busy !== null}
								data-testid="ride-photo-save"
								class="btn btn-secondary min-h-11 {i === 0 &&
								photo.views.length > 1
									? 'col-span-2'
									: ''}"
							>
								<ImageDown size={14} />
								{view === 'world' ? 'Save' : CAMERA_NAMES.heli}
							</button>
						{/each}
						<button
							onclick={() => void remove(photo)}
							disabled={busy !== null}
							aria-label="Delete photo {photo.n}"
							title="Delete photo {photo.n}"
							class="btn btn-secondary min-h-11"
						>
							<Trash2 size={14} />
						</button>
					</div>
				</li>
			{/each}
		</ul>
	</section>
{/if}
