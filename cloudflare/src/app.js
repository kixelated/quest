// The installed app, for signed-in pages: the service worker that shows
// decision notifications, the app icon's unread badge, and the
// notification switch. Served as /app.js; pages work without it.
const unread = Number(document.body.dataset.unread);
if ("setAppBadge" in navigator)
	(unread > 0 ? navigator.setAppBadge(unread) : navigator.clearAppBadge()).catch(() => {});

const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const registration = supported ? navigator.serviceWorker.register("/sw.js") : null;

async function post(path, body) {
	const response = await fetch(path, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || "Request failed.");
}

function key(base64url) {
	const text = atob(base64url.replaceAll("-", "+").replaceAll("_", "/"));
	return Uint8Array.from(text, (c) => c.charCodeAt(0));
}

for (const control of document.querySelectorAll("[data-push]")) {
	const status = control.querySelector("[data-push-status]");
	const enable = control.querySelector("[data-push-enable]");
	const disable = control.querySelector("[data-push-disable]");

	async function show(message) {
		const subscription = supported && (await (await registration).pushManager.getSubscription());
		const on = !!subscription && Notification.permission === "granted";
		const blocked = supported && Notification.permission === "denied";
		// The inbox's compact control steps aside once there is nothing to switch on.
		control.hidden = (on || blocked) && "compact" in control.dataset && !message;
		enable.hidden = !supported || on || blocked;
		disable.hidden = !on;
		status.textContent =
			message ??
			(!supported
				? "This browser can't show notifications here. On an iPhone or iPad, add Quest to your Home Screen from the Share menu, then open it from there."
				: blocked
					? "Notifications are blocked for this site in your browser's settings."
					: on
						? "This device is notified when something needs your decision."
						: "Get a notification on this device when something needs your decision.");
	}

	async function run(button, action) {
		button.disabled = true;
		try {
			await show(await action());
		} catch (error) {
			await show(error.message || "Something went wrong.");
		} finally {
			button.disabled = false;
		}
	}

	// The permission prompt comes only from this click.
	enable.addEventListener("click", () =>
		run(enable, async () => {
			if ((await Notification.requestPermission()) !== "granted") return undefined;
			const subscription = await (
				await registration
			).pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key(control.dataset.push) });
			await post("/push/subscribe", subscription.toJSON());
			return "Notifications are on for this device.";
		}),
	);
	disable.addEventListener("click", () =>
		run(disable, async () => {
			const subscription = await (await registration).pushManager.getSubscription();
			if (subscription) {
				await post("/push/unsubscribe", { endpoint: subscription.endpoint });
				await subscription.unsubscribe();
			}
			return "Notifications are off for this device.";
		}),
	);
	show().catch(() => {});
}
