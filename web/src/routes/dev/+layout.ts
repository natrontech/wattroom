import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';

// Mock screens for design iteration — never reachable in a production build.
// ponytail: the route chunks still ship (a few KB, lazily loaded); gate the door, not the bundle.
export const load = () => {
	if (!dev) error(404, 'Not found');
};
