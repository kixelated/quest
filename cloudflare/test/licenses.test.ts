import { describe, expect, it, vi } from "vitest";
import { osiApproved } from "../src/licenses";

describe("current SPDX OSI approval", () => {
	it.each([undefined, "NOASSERTION", "", "../MIT", "MIT/Apache-2.0", "MIT OR Apache-2.0", "MIT*"])(
		"rejects invalid identifier %s before any external request",
		async (identifier) => {
			const request = vi.fn();
			expect(await osiApproved(identifier, request)).toBe(false);
			expect(request).not.toHaveBeenCalled();
		},
	);
	it("uses only the fixed SPDX source, no credentials, and no positive-result cache", async () => {
		const request = vi
			.fn()
			.mockResolvedValueOnce(Response.json({ licenseId: "MIT", isOsiApproved: true }))
			.mockResolvedValueOnce(Response.json({ licenseId: "MIT", isOsiApproved: false }));
		expect(await osiApproved("MIT", request)).toBe(true);
		expect(await osiApproved("MIT", request)).toBe(false);
		expect(request).toHaveBeenCalledTimes(2);
		expect(request).toHaveBeenLastCalledWith("https://spdx.org/licenses/MIT.json", {
			redirect: "error",
			cache: "no-store",
			headers: { Accept: "application/json" },
		});
	});
	it("fails closed on malformed JSON", async () => {
		const request = vi.fn().mockResolvedValue(new Response("not json"));
		await expect(osiApproved("MIT", request)).rejects.toThrow();
	});
});
