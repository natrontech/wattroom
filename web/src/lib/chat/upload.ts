import { api, type ApiResult } from '$lib/api';

/**
 * A pasted image goes up first (#279, #285); the message then carries only
 * its id. One call for every surface that sends pictures — a text channel
 * and a DM — each with its own images endpoint.
 */
export function uploadImage(
	path: string,
	image: Blob,
): Promise<ApiResult<{ id: string }>> {
	return api<{ id: string }>(path, {
		method: 'POST',
		body: image,
		headers: { 'content-type': image.type },
	});
}
