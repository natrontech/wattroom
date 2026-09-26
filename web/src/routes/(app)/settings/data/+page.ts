import { loadApi } from '$lib/api';
import type { PageLoad } from './$types';

export interface ApiToken {
	id: string;
	name: string;
	createdAt: string;
	lastUsedAt?: string;
}

export const load: PageLoad = async ({ fetch }) => {
	const res = await loadApi<{ tokens: ApiToken[] }>(fetch, '/api/tokens');
	// A failed read is not "no tokens": the section says so and offers the
	// retry (errors.md), instead of inviting a rider to mint a duplicate.
	return {
		tokens: res.ok ? (res.data?.tokens ?? []) : [],
		tokensError: res.ok ? null : res.error.message,
	};
};
