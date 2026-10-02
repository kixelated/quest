//! The clock-free claim envelope shared by validators and forge adapters.

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct Claim {
	pub name: String,
	pub provider: String,
	pub identity: String,
	pub location: String,
	pub date: String,
	pub text: String,
}

impl Claim {
	pub fn parse(text: &str) -> Option<Self> {
		let (claimant, rest) = text.split_once(") on ")?;
		let (name, identity) = claimant.rsplit_once(" (")?;
		let (provider, identity) = identity.split_once(':')?;
		let (location, rest) = rest.split_once(" since ")?;
		let date = rest.split_whitespace().next()?;
		if name.trim().is_empty()
			|| provider.is_empty()
			|| identity.is_empty()
			|| provider.chars().any(char::is_whitespace)
			|| identity.chars().any(char::is_whitespace)
			|| location.trim().is_empty()
			|| !valid_date(date)
		{
			return None;
		}
		Some(Self {
			name: name.into(),
			provider: provider.into(),
			identity: identity.into(),
			location: location.into(),
			date: date.into(),
			text: text.into(),
		})
	}
}

fn valid_date(date: &str) -> bool {
	let bytes = date.as_bytes();
	if bytes.len() != 10
		|| bytes[4] != b'-'
		|| bytes[7] != b'-'
		|| bytes
			.iter()
			.enumerate()
			.any(|(i, byte)| i != 4 && i != 7 && !byte.is_ascii_digit())
	{
		return false;
	}
	let year: u16 = date[..4].parse().expect("ASCII digits");
	let month: u8 = date[5..7].parse().expect("ASCII digits");
	let day: u8 = date[8..].parse().expect("ASCII digits");
	let max = match month {
		1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
		4 | 6 | 9 | 11 => 30,
		2 if year.is_multiple_of(400) || year.is_multiple_of(4) && !year.is_multiple_of(100) => 29,
		2 => 28,
		_ => return false,
	};
	year != 0 && (1..=max).contains(&day)
}

/// Release the one valid Claim section without altering other source bytes.
pub fn remove(content: &str) -> anyhow::Result<String> {
	let doc = crate::Doc::from_str("quest/claim.md".into(), content);
	if !doc.has("Claim") {
		return Ok(content.to_string());
	}
	if doc.claim().is_none() || doc.claim_ranges.len() != 1 {
		anyhow::bail!("cannot remove an invalid Claim section");
	}
	let range = &doc.claim_ranges[0];
	Ok(format!("{}{}", &content[..range.start], &content[range.end..]))
}

/// Compare a Claim-only edit, allowing only its newly inserted blank separator.
pub fn is_addition(before: &str, after: &str) -> anyhow::Result<bool> {
	let original = crate::Doc::from_str("quest/claim.md".into(), before);
	let changed = crate::Doc::from_str("quest/claim.md".into(), after);
	if original.has("Claim") || changed.claim().is_none() || changed.claim_ranges.len() != 1 {
		return Ok(false);
	}
	if remove(after)? == before {
		return Ok(true);
	}
	let range = &changed.claim_ranges[0];
	let prefix = &after[..range.start];
	let suffix = &after[range.end..];
	for separator in ["\r\n", "\n", "\r\n\r\n", "\n\n"] {
		if let Some(base) = prefix.strip_suffix(separator) {
			// One extra newline after an existing line break; two only when the
			// original preceding line lacked its terminator.
			let line_ended = base.ends_with('\n');
			let already_separated = base
				.strip_suffix("\r\n")
				.or_else(|| base.strip_suffix('\n'))
				.is_some_and(|line| line.ends_with('\n'));
			let single = separator == "\n" || separator == "\r\n";
			if !already_separated && line_ended == single && format!("{base}{suffix}") == before {
				return Ok(true);
			}
		}
	}
	Ok(false)
}
