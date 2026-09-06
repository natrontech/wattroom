/** What each sign-in provider is called, wherever one is named to a rider. */
export const providerName: Record<string, string> = {
	google: 'Google',
	github: 'GitHub',
	strava: 'Strava',
	dev: 'Dev sign-in',
};

export const nameOf = (id: string): string => providerName[id] ?? id;
