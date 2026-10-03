import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import authClient from "../src/generated/auth-client";

it("shows unsupported passkey errors and re-enables the rendered sign-in control", async () => {
	let listener: () => Promise<void> = async () => {};
	const button = {
		dataset: { authAction: "passkey-sign-in" },
		disabled: false,
		addEventListener(_event: string, handler: () => Promise<void>) {
			listener = handler;
		},
	};
	const status = { textContent: "" };
	const destinations: string[] = [];
	runInNewContext(authClient, {
		document: { querySelector: () => status, querySelectorAll: () => [button] },
		window: { location: { origin: "http://localhost:8787", assign: (path: string) => destinations.push(path) } },
		navigator: {},
		Headers,
		Request,
		Response,
		URL,
		URLSearchParams,
		console,
		fetch: () => {
			throw new Error("Unsupported browsers must not fetch authentication challenges");
		},
	});
	await listener();
	expect(status.textContent).toMatch(/not supported|did not finish|not available/i);
	expect(button.disabled).toBe(false);
	expect(destinations).toEqual([]);
});
