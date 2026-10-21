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
	const result = await response.json().catch(() => null);
	if (!response.ok) throw new Error(result?.error || "Request failed.");
	return result;
}

function key(base64url) {
	const text = atob(base64url.replaceAll("-", "+").replaceAll("_", "/"));
	return Uint8Array.from(text, (c) => c.charCodeAt(0));
}

// The browser's subscription, dropping one made for an earlier key pair: it
// cannot receive pushes signed with the current key, and it blocks subscribing
// with the new one.
async function current(publicKey) {
	const subscription = await (await registration).pushManager.getSubscription();
	const made = subscription?.options.applicationServerKey;
	const want = key(publicKey);
	if (!made || (made.byteLength === want.length && new Uint8Array(made).every((b, i) => b === want[i])))
		return subscription;
	await post("/push/unsubscribe", { endpoint: subscription.endpoint }).catch(() => {});
	await subscription.unsubscribe();
	return null;
}

// Whether the server notifies this browser's subscription for whoever is
// signed in. It forgets one when a session signs out, and never hands one to
// another user, so the browser's own subscription is not enough to show "on".
const controls = document.querySelectorAll("[data-push]");
let stored = false;
const checked = (async () => {
	if (!supported || !controls.length || Notification.permission !== "granted") return;
	const subscription = await current(controls[0].dataset.push);
	if (subscription) stored = (await post("/push/check", { endpoint: subscription.endpoint })).stored === true;
})();

for (const control of controls) {
	const status = control.querySelector("[data-push-status]");
	const enable = control.querySelector("[data-push-enable]");
	const disable = control.querySelector("[data-push-disable]");

	async function show(message) {
		const subscription = supported && (await (await registration).pushManager.getSubscription());
		const on = stored && !!subscription && Notification.permission === "granted";
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
			await current(control.dataset.push);
			const subscription = await (
				await registration
			).pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key(control.dataset.push) });
			await post("/push/subscribe", subscription.toJSON());
			stored = true;
			return "Notifications are on for this device.";
		}),
	);
	disable.addEventListener("click", () =>
		run(disable, async () => {
			const subscription = await (await registration).pushManager.getSubscription();
			if (subscription) {
				await post("/push/unsubscribe", { endpoint: subscription.endpoint });
				stored = false;
				await subscription.unsubscribe();
			}
			return "Notifications are off for this device.";
		}),
	);
	checked
		.then(
			() => show(),
			(error) => show(error.message || "Something went wrong."),
		)
		.catch(() => {});
}
