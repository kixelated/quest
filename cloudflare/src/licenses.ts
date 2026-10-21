/** Current published SPDX metadata includes OSI approval, not just a known ID.
 * Fetch it for each decision so a prior positive result never grants access.
 * https://github.com/spdx/license-list-data/blob/main/accessingLicenses.md
 */
export async function osiApproved(identifier: string | undefined, request: typeof fetch = fetch): Promise<boolean> {
	if (!identifier || identifier === "NOASSERTION" || !/^[a-zA-Z0-9][a-zA-Z0-9.-]*\+?$/.test(identifier)) return false;
	const response = await request(`https://spdx.org/licenses/${encodeURIComponent(identifier)}.json`, {
		// Workers refuse `redirect: "error"`; a redirect is not ok, so it fails below.
		redirect: "manual",
		cache: "no-store",
		headers: { Accept: "application/json" },
	});
	if (response.status === 404) return false;
	if (!response.ok) throw new Error("License approval data unavailable");
	const data: unknown = await response.json();
	if (
		!data ||
		typeof data !== "object" ||
		!("licenseId" in data) ||
		!("isOsiApproved" in data) ||
		typeof data.licenseId !== "string" ||
		typeof data.isOsiApproved !== "boolean"
	)
		throw new Error("License approval data invalid");
	return data.licenseId === identifier && data.isOsiApproved === true;
}
