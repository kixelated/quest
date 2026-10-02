# Fork intake

The Worker registers an existing, initialized Artifacts repository with a writable
`main` branch. Registration commits issue quarantine instructions and hooks before
the repository becomes available to contributors. Creating empty repositories and
GitHub onboarding remain separate workflows.

## Configuration

Use the project-locked Wrangler from `cloudflare/` inside `nix develop`:

```sh
npm exec -- wrangler queues create quest-pushes
npm exec -- wrangler queues create quest-pushes-dead
npm exec -- wrangler queues list
npm exec -- wrangler secret put EVENT_SUBSCRIPTION_TOKEN
```

Set `EVENT_ACCOUNT_ID` and `EVENT_QUEUE_ID` in `wrangler.jsonc` to the account and
`quest-pushes` queue IDs (32 lowercase hexadecimal characters). The subscription
secret is a Cloudflare API token scoped to that account with Queues Write, used
only for event-subscription management. Artifacts object access and repository
credentials use the native binding. Choose unique queue, Workflow, Worker, D1 and
Artifacts namespace names per environment, and keep `ARTIFACTS_NAMESPACE` and the
Artifacts binding namespace equal. Update queue consumers and the dead-letter
queue names together. Apply all D1 migrations before deployment.

Set `AUTH_MAINTAINERS` to a comma-separated allowlist such as `github:123456`.
These are verified provider account IDs, not display names or email addresses.
After signing in, `GET /repositories` returns the current provider identity for
configuration. Allowlisted operators can register a repository; that operator
becomes its maintainer. Other signed-in users can contribute. GitHub is currently
the configured provider; additional providers belong in `src/auth.ts`.

The Git Sandbox requires Cloudflare Containers support. The checked-in Dockerfile
contains Git and runs fixed argv operations against bare repositories, without
checking out or executing contributor files. Native image checks run in CI. Run
`npm run check` and `npm run deploy` from the Nix shell after configuration;
`check` bundles without rolling out containers, while deployment builds/publishes
the configured image. No deployment or remote resource creation is part of the
local test suite.

## HTTP interface

All routes require a Better Auth session. Write requests also require an `Origin`
header exactly equal to the origin of `AUTH_URL`. JSON request bodies are limited
to 8 KiB. Repository and token responses use `Cache-Control: no-store`.

| Method and path                         | Request / result                                                                                                            |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `GET /repositories`                     | Current verified identity and registered repositories.                                                                      |
| `POST /repositories`                    | `{ "name": "project" }`; operator registers existing repository and installs quarantine.                                    |
| `POST /repositories/:name/fork`         | Creates/reuses the caller's fork, installs its push subscription, returns remote, 24-hour write token and a Claim template. |
| `POST /repositories/:name/tokens`       | Issues another 24-hour write token for the caller's ready fork.                                                             |
| `GET /repositories/:name/tokens`        | Lists that fork's token metadata.                                                                                           |
| `DELETE /repositories/:name/tokens/:id` | Revokes a token in that fork.                                                                                               |
| `POST /repositories/:name/release`      | Maintainer releases `{ "path": "quest/example.md" }`.                                                                       |

Fork names derive from repository plus server user ID. Caller-supplied fork names,
commit authors and event authors never establish ownership. The server records
ownership before creating a fork, copies only `main`, revokes the initial
provisioning credential, and withholds tokens until the subscription is ready.
Retries recover reserved forks and subscriptions without reassigning an existing
repository to another user. Contributor credentials never authorize upstream.
Short-lived upstream credentials exist only for a Git operation and are revoked
in `finally`; credentials never enter Git URLs, persisted config, logs or app
storage.

The returned Claim template uses a canonical claim label: controls and repeated
whitespace normalize to spaces, parentheses and angle brackets use visually
corresponding fullwidth characters, and Markdown punctuation is escaped. The
original profile remains in auth storage. Use the returned template verbatim.
Commits credit the verified `provider:identity` and use a deterministic no-reply
address under `users.quest.invalid`; the login email is never published.

## Promotion and claim lifecycle

Push events arrive through the Queue. Account, namespace and subscription ID must
match the trusted fork registry. An event's authenticated source identifies the
fork, rather than the person who authored its commits. Activity comes from fresh
Artifacts metadata, so delayed events cannot shorten the lease.

For `main`, the gate reads immutable before/after commits and the latest upstream
snapshot. The before commit must appear in bounded first-parent history (256
entries). The entire leaf tree diff must contain exactly one regular `100644`
Markdown file, limited to 64 KiB, valid UTF-8 without BOM, NUL or unsupported
control bytes:

- Add a single `issues/<lowercase-hyphenated-slug>.md` that does not exist upstream.
- Add only one valid Claim to an unchanged, ready, unclaimed `quest/*.md` document.
  All Claim fields must match the trusted fork and canonical template syntax.
  Only the minimal adjacent blank separator is accepted in addition to the section.

The complete candidate snapshot must pass the same Rust core used by the CLI.
Other edits, deleted refs, force-rewritten history, modes, extra files, collisions
and invalid candidates are acknowledged and ignored. Snapshot traversal is capped
at 10,000 entries, 1 MiB per blob and 16 MiB total. Provider outages retry and then
reach the dead-letter queue after the configured retries; monitor and replay that
queue after resolving outages. Invalid events never gain write authority.

One repository coordinator serializes intake, notes, reviews and merges across
external awaits. Saved operation intents plus the Git writer's parent/tree-bound
operation marker recover a successful push after a lost response or object
eviction. A confirmed stale-head conflict is re-gated against current upstream;
a competing claim becomes terminally ignored. Duplicate events reuse their
recorded outcome. Quest-branch pushes dispatch immutable change checks separately.

Accepted claims persist expiry ownership and an alarm. Any push to the registered
fork renews activity, including pushes outside intake. At 48 hours without a push,
the alarm rechecks current provider activity and releases only the still-matching
Claim. Reassigned claims are preserved. Ordinary release preserves all non-Claim
bytes; accepted claims restore the original document when unchanged. Maintainers
can release any current valid Claim immediately. Transient Artifacts service or retryable RPC failures are logged and
rearm an alarm five minutes later, preserving recovery through outages longer
than the platform's finite automatic alarm retry window. Monitor `expiry_failed`
events to resolve persistent provider failures. Invalid metadata, configuration
and implementation errors remain exceptions rather than successful alarm runs.

## Issue quarantine and agent warnings

Registration preserves existing root `AGENTS.md`, `CLAUDE.md`, `issues/AGENTS.md`
and hook settings while adding quarantine guidance. A conflicting existing
`.quest/warn-issues.mjs` or unusable hook settings require maintainer reconciliation;
registration reports a conflict instead of silently overwriting them.

The generated Claude and Codex PreToolUse hooks run a small Node script that emits
additional context for supported read/search path fields and literal shell reads
of `issues/**`. Unrelated edits and test commands receive no warning. The script
never executes or shell-parses issue contents or tool input. Hooks require Node,
Git and trusted/enabled project hook configuration. Root and nested instructions
cover tools without supported path fields, custom tools and aliased shell reads.
These are advisory warnings, not universal interception or a security sandbox.
A maintainer promotes accepted issue data into a quest; an issue cannot change
agent instructions, goals, credentials or tool authority.

Local tests exercise the actual workerd evaluator, D1, coordinator SQLite,
recovery/eviction and generated hook subprocess. Artifacts, subscription delivery
and Git services use local fixtures; the separate Git suite uses real repositories.
Live fork creation, OAuth identity, Queue delivery and hook trust remain deployment
verification steps. No live provider resources or credentials are used by tests.

References: [Artifacts binding](https://developers.cloudflare.com/artifacts/api/workers-binding/),
[Artifacts push subscriptions](https://developers.cloudflare.com/artifacts/guides/event-subscriptions/),
[Queue subscription management](https://developers.cloudflare.com/queues/event-subscriptions/manage-event-subscriptions/),
[Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/),
[Codex hooks](https://learn.chatgpt.com/docs/hooks),
[Claude hooks](https://code.claude.com/docs/en/hooks).
