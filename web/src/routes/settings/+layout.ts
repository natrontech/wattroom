import { loadApi } from '$lib/api';
import type { LayoutLoad } from './$types';

// The footer's build line, decorative (#345): the release tag when the
// build is one, the commit otherwise.
export const load: LayoutLoad = async ({ fetch }) => {
	const res = await loadApi<{ commit: string; version?: string }>(
		fetch,
		'/api/version',
	);
	const tag = res.ok ? res.data?.version : undefined;
	return {
		version: res.ok ? (res.data?.commit ?? null) : null,
		release: tag && tag !== 'dev' ? tag : null,
	};
};
