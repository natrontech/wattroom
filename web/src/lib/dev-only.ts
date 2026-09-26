import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';

/**
 * Mock screens for design iteration and measurement — never reachable in a
 * production build.
 * ponytail: the route chunks still ship (a few KB, lazily loaded); gate the
 * door, not the bundle.
 */
export function devOnly() {
	if (!dev) error(404, 'Not found');
}
