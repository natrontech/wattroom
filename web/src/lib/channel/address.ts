/**
 * Where the live shell is standing, and every path that follows from it
 * (ADR-0058, #2449). The shell used to be a room's alone and built each path
 * from the slug where it needed one; a voice channel is the same Lounge on a
 * different address, so the paths live here, once, and the shell and its
 * places read them from the connection or the context.
 */
export interface PlaceAddress {
	/** What the one live connection is keyed by (#173). */
	key: string;
	/** The voice channel's id. */
	channel: string;
	/** The crew the voice channel belongs to. */
	crew: string;
	/** What notifications and the "you are in" strip call it. */
	name: string;
	/** The live socket. */
	ws: string;
	/** The voice token. */
	avToken: string;
	/** The page the place lives at, and where its ride is drawn. */
	home: string;
	training: string;
	/** The shelf the jukebox lists: the crew's. */
	playlists: string;
	/** Queue a saved playlist onto this deck. */
	queuePlaylist: (id: string) => string;
	/** Queue library tracks onto this deck (#1433). */
	queueTracks: string;
	/** Who is in it, and how to bring someone new. */
	members: string;
}

export function channelAddress(
	crew: string,
	channel: string,
	name: string,
): PlaceAddress {
	const api = `/api/channels/${channel}`;
	const home = `/crew/${crew}/v/${channel}`;
	return {
		key: `v:${channel}`,
		channel,
		crew,
		name,
		ws: `/ws/channels/${channel}`,
		avToken: `${api}/av-token`,
		home,
		// The channel's ride place while nothing runs — where a trainer is
		// paired and a session opened; a running session has its own address
		// (ridePath, #2450).
		training: `${home}/training`,
		playlists: `/api/crews/${crew}/playlists`,
		queuePlaylist: (id) => `${api}/playlists/${id}/queue`,
		queueTracks: `${api}/queue`,
		members: `/crew/${crew}/members`,
	};
}

/** A running session's own page (#2450), in the crew it runs in. */
export const sessionPath = (crew: string, sessionId: string) =>
	`/crew/${crew}/s/${sessionId}`;

/**
 * Where the ride is (#2450): the running session at its own address, else
 * the channel's Training.
 */
export function ridePath(address: PlaceAddress, sessionId?: string): string {
	return sessionId ? sessionPath(address.crew, sessionId) : address.training;
}

/**
 * Whether `pathname` is one of the live place's own pages (#2460): its
 * Lounge and Training, or the page of the session `sessionId` running in it,
 * which a voice channel addresses under its crew rather than under itself
 * (#2450). The checks that asked `startsWith('/r/')` went quietly false when
 * the `/r/` pages went; they ask this.
 */
export function onPlacePath(
	pathname: string,
	address: PlaceAddress,
	sessionId?: string,
): boolean {
	return [address.home, address.training, ridePath(address, sessionId)].some(
		(path) => pathname === path || pathname.startsWith(`${path}/`),
	);
}

/**
 * The voice channel a path puts the rider in (#2602): a voice channel's own
 * pages, or a session's — resolved through `sessionChannel`, since a session
 * is addressed under its crew. Undefined for every path that joins nothing,
 * and for a session nobody can place (one that has ended joins nothing too).
 */
export function channelOfPath(
	pathname: string,
	sessionChannel: (crew: string, sessionId: string) => string | undefined,
): string | undefined {
	const place = /^\/crew\/([^/]+)\/(v|s)\/([^/]+)/.exec(pathname);
	if (!place) return undefined;
	const [, crew, kind, id] = place;
	return kind === 'v' ? id : sessionChannel(crew, id);
}
