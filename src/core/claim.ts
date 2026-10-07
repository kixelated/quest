// The `## Claim` envelope: `Name (provider:identity) on location since YYYY-MM-DD`.
//
// Claims use a small, forge-independent envelope. The location and any
// trailing fields are opaque; neither forge policy nor expiry belongs here.

/** One parsed claim. */
export interface Claim {
	/** The claimant's display name. */
	name: string;
	/** The identity provider, such as `github`. */
	provider: string;
	/** The claimant's identity at that provider. */
	identity: string;
	/** The fork or branch the work happens on. */
	location: string;
	/** The `YYYY-MM-DD` the claim was made. */
	since: string;
	/** Fields a forge appended after the date, as written. */
	extra: string;
}

/** Parse a claim entry's rendered text, or `null` if it is not a valid claim. */
export function parseClaim(text: string): Claim | null {
	const [claimant, rest] = splitOnce(text, ") on ") ?? [];
	if (claimant === undefined || rest === undefined) return null;
	// Parentheses in the display name are not the provider delimiter.
	const open = claimant.lastIndexOf(" (");
	if (open < 0) return null;
	const name = claimant.slice(0, open);
	const [provider, identity] = splitOnce(claimant.slice(open + 2), ":") ?? [];
	if (provider === undefined || identity === undefined) return null;
	// Fields after the date are opaque, even if they contain " since ".
	const [location, dated] = splitOnce(rest, " since ") ?? [];
	if (location === undefined || dated === undefined) return null;
	const [since = "", ...extra] = dated.trim().split(/\s+/);

	const valid =
		name.trim() !== "" &&
		provider !== "" &&
		identity !== "" &&
		!/\s/.test(provider) &&
		!/\s/.test(identity) &&
		location.trim() !== "" &&
		validDate(since);
	if (!valid) return null;
	return { name: name.trim(), provider, identity, location: location.trim(), since, extra: extra.join(" ") };
}

function splitOnce(text: string, separator: string): [string, string] | null {
	const index = text.indexOf(separator);
	return index < 0 ? null : [text.slice(0, index), text.slice(index + separator.length)];
}

/** A real calendar date written `YYYY-MM-DD`. */
function validDate(date: string): boolean {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
	if (!match) return false;
	const [year, month, day] = match.slice(1).map(Number);
	const leap = year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);
	const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
	return year !== 0 && days !== undefined && day >= 1 && day <= days;
}
