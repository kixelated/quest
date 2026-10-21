// The signed-in pages' script, run against a stand-in browser.
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

it("drops the browser's push subscription and clears the app badge before signing out", async () => {
	const steps: string[] = [];
	const subscription = {
		endpoint: "https://fcm.googleapis.com/fcm/send/device",
		unsubscribe: async () => steps.push("unsubscribe"),
	};
	let submit: ((event: { preventDefault(): void }) => void) | undefined;
	const form = {
		addEventListener: (type: string, listener: typeof submit) => {
			if (type === "submit") submit = listener;
		},
		submit: () => steps.push("submit"),
	};
	vi.stubGlobal("document", {
		body: { dataset: {} },
		querySelectorAll: (selector: string) => (selector === 'form[action="/sign-out"]' ? [form] : []),
	});
	vi.stubGlobal("window", { PushManager: class {}, Notification: class {} });
	vi.stubGlobal("Notification", { permission: "granted" });
	vi.stubGlobal("navigator", {
		serviceWorker: { register: async () => ({ pushManager: { getSubscription: async () => subscription } }) },
		clearAppBadge: async () => steps.push("clear"),
	});
	// @ts-expect-error: a browser script with no type declarations.
	await import("../src/app.js");
	steps.length = 0;
	let prevented = false;
	submit!({ preventDefault: () => (prevented = true) });
	expect(prevented).toBe(true);
	await vi.waitFor(() => expect(steps).toHaveLength(3));
	expect(steps.slice(0, 2).sort()).toEqual(["clear", "unsubscribe"]);
	expect(steps[2]).toBe("submit");
});
