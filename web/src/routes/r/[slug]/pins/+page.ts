import { redirect } from '@sveltejs/kit';

/**
 * `/r/[slug]/pins` became `/r/[slug]/board` (#2413): the place holds the
 * room's announcement as well as the crew's pins, so it is named for what it
 * is rather than for one of the things on it.
 *
 * The old path shipped in 2026.09.122 and rode two releases, so it may be in
 * a bookmark or a link somebody pasted into chat. A redirect costs four
 * lines; a 404 costs whoever followed it.
 */
export const load = ({ params }) => {
	redirect(308, `/r/${params.slug}/board`);
};
