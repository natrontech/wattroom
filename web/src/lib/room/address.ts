/**
 * Where the live shell is standing, and every path that follows from it
 * (ADR-0058, #2449). The shell used to be a room's alone and built each path
 * from the slug where it needed one; a voice channel is the same Lounge on a
 * different address, so the paths live here, once, and the shell and its
 * places read them from the connection or the context.
 *
 * The room's address goes with the room (#2460); until then both exist, and
 * a room never answers what a voice channel does not have (chat, the room's
 * own autoplay endpoint) — and a voice channel never answers what only the
 * room had.
 */
export interface PlaceAddress {
	/** What the one live connection is keyed by (#173). */
	key: string;
	/** The room's slug; '' on a voice channel, so it matches no room. */
	slug: string;
	/** A voice channel's id; '' on a room. */
	channel: string;
	/** A voice channel's crew; '' on a room. */
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
	/** The room's chat log; a voice channel has none (ADR-0058, decision 4). */
	chat?: string;
	/** The shelf the jukebox lists: the room's, or the crew's. */
	playlists: string;
	/** Queue a saved playlist onto this deck. */
	queuePlaylist: (id: string) => string;
	/** Queue library tracks onto this deck (#1433). */
	queueTracks: string;
	/** The room's autoplay; a voice channel's is its crew's settings (#2454). */
	autoplay?: string;
	/** Who is in it, and how to bring someone new. */
	members: string;
	/** Where sessions are planned — absent until the crew's schedule is a
	 *  page (#2452), so nothing links to a place that is not there. */
	schedule?: string;
}

export function roomAddress(slug: string, name = slug): PlaceAddress {
	const api = `/api/rooms/${slug}`;
	return {
		key: slug,
		slug,
		channel: '',
		crew: '',
		name,
		ws: `/ws/rooms/${slug}`,
		avToken: `${api}/av-token`,
		home: `/r/${slug}`,
		training: `/r/${slug}/training`,
		chat: `${api}/chat`,
		playlists: `${api}/playlists`,
		queuePlaylist: (id) => `${api}/playlists/${id}/queue`,
		queueTracks: `${api}/queue`,
		autoplay: `${api}/autoplay`,
		members: `/r/${slug}/members`,
		schedule: `/r/${slug}/sessions`,
	};
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
		slug: '',
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
 * Where the ride is (#2450): a voice channel's running session at its own
 * address, else the place's Training.
 */
export function ridePath(address: PlaceAddress, sessionId?: string): string {
	return address.channel && sessionId
		? sessionPath(address.crew, sessionId)
		: address.training;
}

/**
 * Whether `pathname` is one of the live place's own pages (#2460): its
 * Lounge and Training, or the page of the session `sessionId` running in it,
 * which a voice channel addresses under its crew rather than under itself
 * (#2450). The checks that asked `startsWith('/r/')` went quietly false with
 * the room pages; they ask this.
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
