-- What a new planning interview starts from: the maintainer's idea in their
-- own words, and an optional pasted block (an email, call notes, findings, or
-- a finished job's suggested follow-ups), which agents read as untrusted
-- context like issue text. A retry keeps both.
ALTER TABLE jobs ADD COLUMN idea TEXT;
ALTER TABLE jobs ADD COLUMN context TEXT;
