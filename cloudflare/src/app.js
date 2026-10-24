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

// Signing out stops this device's notifications at once and clears the app
// badge, which signed-out pages never update. The server forgets the session's
// subscriptions, and dropping the browser's own also discards any push the push
// service still holds for it. A sign-out without JavaScript leaves those to
// arrive within their TTL.
for (const form of document.querySelectorAll('form[action="/sign-out"]')) {
	form.addEventListener(
		"submit",
		(event) => {
			event.preventDefault();
			const steps = [
				"clearAppBadge" in navigator ? navigator.clearAppBadge() : null,
				supported
					? registration
							.then((found) => found.pushManager.getSubscription())
							.then((subscription) => subscription?.unsubscribe())
					: null,
			];
			Promise.allSettled(steps).then(() => form.submit());
		},
		{ once: true },
	);
}

// A job's raw output loads only when a maintainer opens its disclosure, a page
// at a time, and the server rechecks their authority on every page. It is
// shown as text, never markup.
for (const details of document.querySelectorAll("details[data-output]")) {
	const output = details.querySelector("pre");
	const status = details.querySelector("[data-output-status]");
	const more = details.querySelector("[data-output-more]");
	let next = null;
	let started = false;
	async function load() {
		more.disabled = true;
		try {
			const url = new URL(details.dataset.output, location.href);
			if (next) url.searchParams.set("after", `${next.attempt}.${next.seq}`);
			const response = await fetch(url, { headers: { Accept: "application/json" } });
			const page = await response.json().catch(() => null);
			if (!response.ok) throw new Error(page?.error || "The raw output could not be read.");
			output.append(page.output.map((chunk) => chunk.text).join(""));
			output.hidden = !output.textContent;
			next = page.next;
			more.hidden = !next;
			status.textContent = !output.textContent
				? "No raw output is stored for this job."
				: page.truncated.length
					? "Some output was dropped at the size limit."
					: "";
		} catch (error) {
			status.textContent = error.message || "Something went wrong.";
			// Opening the disclosure again retries a first page that failed.
			if (!output.textContent) started = false;
		} finally {
			more.disabled = false;
		}
	}
	details.addEventListener("toggle", () => {
		if (!details.open || started) return;
		started = true;
		load();
	});
	more.addEventListener("click", load);
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
