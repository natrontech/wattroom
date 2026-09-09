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
	return { tokens: res.ok ? (res.data?.tokens ?? []) : [] };
};
