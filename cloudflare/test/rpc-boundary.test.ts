import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { intakeStatus } from "../src/intake/registry";
import { owner } from "./intake-fixtures";
it("preserves authoritative rejection across the real coordinator RPC boundary", async () => {
	try {
		await env.REPOSITORIES.getByName("rpc-error").register("upstream", owner);
		throw new Error("expected rejection");
	} catch (error) {
		expect(intakeStatus(error)).toBe(403);
		expect((error as Error).message).toBe("Operator registration required");
	}
});

it("does not mistake provider or arbitrary failures for authorization", () => {
	expect(intakeStatus(new Error("Provider unavailable"))).toBeNull();
});
