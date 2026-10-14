/** Redirect only the retired hostname to the configured, trusted origin. */
export function canonicalRedirect(request: Request, authURL: string): Response | null {
	const source = new URL(request.url);
	if (source.hostname !== "kixel.quest") return null;
	// Assign the pathname separately: a path beginning // must not replace the host.
	const target = new URL(new URL(authURL).origin);
	target.pathname = source.pathname;
	target.search = source.search;
	const authentication =
		source.pathname === "/api/auth" ||
		source.pathname.startsWith("/api/auth/") ||
		source.pathname === "/sign-in" ||
		source.pathname === "/sign-out";
	if (authentication) {
		// Old host cookies cannot validate OAuth state on the new host. Restart
		// there without forwarding codes, state, request bodies, or session tokens.
		target.pathname = "/";
		target.search = "";
	}
	return new Response(null, {
		status: authentication ? 303 : 308,
		headers: { Location: target.href, "Cache-Control": authentication ? "no-store" : "public, max-age=3600" },
	});
}
