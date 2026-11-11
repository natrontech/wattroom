import { api, apiBlob, type ApiResult } from '#lib/api.ts';

/**
 * A ride's photos on its page (docs/spec/riding.md "The ride's pictures"):
 * the ones the rider took with Photo, kept with the ride, the rider's alone
 * whatever the ride's sharing says.
 */
export type RidePhoto = {
	n: number;
	views: PhotoView[];
	savedAt: string;
};

/** You on the road, and the same moment from the Overhead camera. */
export type PhotoView = 'world' | 'overhead';

export function photoUrl(rideId: string, n: number, view: PhotoView): string {
	return `/api/rides/${encodeURIComponent(rideId)}/photos/${n}/${view}`;
}

/** The file a view saves as: the ride's day, the photo, the view. */
export function photoFilename(
	startedAt: string,
	n: number,
	view: PhotoView,
): string {
	const day = startedAt.slice(0, 10);
	return `wattroom-${day}-photo-${n}${view === 'overhead' ? '-overhead' : ''}.jpg`;
}

export async function listPhotos(
	rideId: string,
): Promise<ApiResult<RidePhoto[]>> {
	const res = await api<{ photos: RidePhoto[] }>(
		`/api/rides/${encodeURIComponent(rideId)}/photos`,
	);
	return res.ok ? { ok: true, data: res.data.photos ?? [] } : res;
}

/**
 * Deletes one photo, both views, and hands back how to put it back: the
 * bytes are read first, so Undo restores exactly what was there (errors.md:
 * undo over confirm). Nothing is deleted when the bytes cannot be read.
 */
export async function deletePhoto(
	rideId: string,
	photo: RidePhoto,
): Promise<ApiResult<{ restore: () => Promise<ApiResult<void>> }>> {
	const kept: [PhotoView, Blob][] = [];
	for (const view of photo.views) {
		const res = await apiBlob(photoUrl(rideId, photo.n, view));
		if (!res.ok) return res;
		kept.push([view, res.data.blob]);
	}
	const gone = await api<void>(
		`/api/rides/${encodeURIComponent(rideId)}/photos/${photo.n}`,
		{ method: 'DELETE' },
	);
	if (!gone.ok) return gone;
	return {
		ok: true,
		data: {
			async restore() {
				for (const [view, blob] of kept) {
					const res = await api<void>(photoUrl(rideId, photo.n, view), {
						method: 'PUT',
						body: blob,
						headers: { 'content-type': 'image/jpeg' },
					});
					if (!res.ok) return res;
				}
				return { ok: true, data: undefined };
			},
		},
	};
}
