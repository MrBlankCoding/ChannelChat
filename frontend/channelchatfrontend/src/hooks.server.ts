import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	const session = event.cookies.get('session');

	if (!session) {
		console.log('[Server Hook] No session cookie found');
		event.locals.user = null;
	} else {
		try {
			const base64Payload = session.split('.')[1];
			// Use Buffer for safer decoding on the server
			const payload = JSON.parse(Buffer.from(base64Payload, 'base64').toString());
			
			event.locals.user = {
				email: payload.email,
				uid: payload.user_id
			};
			console.log(`[Server Hook] User hydrated from cookie: ${payload.email}`);
		} catch (e) {
			console.error('[Server Hook] Failed to decode session cookie:', e);
			event.locals.user = null;
		}
	}

	const response = await resolve(event);
	response.headers.set('Cross-Origin-Opener-Policy', 'unsafe-none');
	return response;
};
