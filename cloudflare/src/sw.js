// The service worker: shows decision notifications and opens the decision
// when one is tapped. Notifications carry no answer actions; every answer is
// made in the inbox. It caches nothing, so pages always load fresh.
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
	let message = {};
	try {
		message = event.data?.json() ?? {};
	} catch {}
	const badge = Number(message.badge);
	event.waitUntil(
		Promise.all([
			// One tag per decision item replaces its earlier notification.
			self.registration.showNotification(message.title || "Quest", {
				body: message.body || "Something needs your decision.",
				tag: message.tag,
				icon: "/theme/icon-192.png",
				data: { url: message.url },
			}),
			"setAppBadge" in navigator
				? (badge > 0 ? navigator.setAppBadge(badge) : navigator.clearAppBadge()).catch(() => {})
				: null,
		]),
	);
});

self.addEventListener("notificationclick", (event) => {
	event.notification.close();
	// Only ever open a page on this site.
	const url = new URL(event.notification.data?.url || "/inbox", self.location.origin);
	if (url.origin !== self.location.origin) return;
	event.waitUntil(
		(async () => {
			const windows = await self.clients.matchAll({ type: "window" });
			const open = windows.find((client) => new URL(client.url).origin === url.origin);
			if (open) {
				await open.focus();
				// Navigating needs a page this worker controls; otherwise open another.
				return open.navigate(url.href).catch(() => self.clients.openWindow(url.href));
			}
			return self.clients.openWindow(url.href);
		})(),
	);
});

// A browser that replaces its subscription keeps notifying under the new one.
self.addEventListener("pushsubscriptionchange", (event) => {
	const old = event.oldSubscription;
	if (!old?.options.applicationServerKey) return;
	event.waitUntil(
		(async () => {
			const subscription =
				event.newSubscription ??
				(await self.registration.pushManager.subscribe({
					userVisibleOnly: true,
					applicationServerKey: old.options.applicationServerKey,
				}));
			await fetch("/push/subscribe", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ...subscription.toJSON(), replaces: old.endpoint }),
			});
		})(),
	);
});
