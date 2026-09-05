import { loadApi } from '$lib/api';
import { fetchProgression, type TrendRide } from '$lib/progression';
import type { PageLoad } from './$types';

export interface ApiToken {
	id: string;
	name: string;
	createdAt: string;
	lastUsedAt?: string;
}

export const load: PageLoad = async ({ fetch }) => {
	const [progressionResult, tokensResult, versionResult] = await Promise.all([
		fetchProgression(fetch),
		loadApi<{ tokens: ApiToken[] }>(fetch, '/api/tokens'),
		loadApi<{ commit: string; version?: string }>(fetch, '/api/version'),
	]);
	const version = versionResult.ok
		? (versionResult.data?.commit ?? null)
		: null;
	const tag = versionResult.ok ? versionResult.data?.version : undefined;
	return {
		trend: progressionResult.ok ? (progressionResult.data?.rides ?? []) : [],
		tokens: tokensResult.ok ? (tokensResult.data?.tokens ?? []) : [],
		version,
		release: tag && tag !== 'dev' ? tag : null,
	};
};

export type ProfilePageData = {
	trend: TrendRide[];
	tokens: ApiToken[];
	version: string | null;
	release: string | null;
};
