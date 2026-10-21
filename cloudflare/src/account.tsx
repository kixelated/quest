import type { Child } from "hono/jsx";
import { type Provider, providerNames } from "./auth";
import { Notifications } from "./layout";

// Sign-in choices and the signed-in account's methods. OAuth uses plain forms;
// only the WebAuthn ceremonies need /passkey.js, which reveals its buttons
// where the browser supports passkeys.

export type Passkey = { id: string; name?: string | null; createdAt: Date | string | null };

// Better Auth reports OAuth failures as `?error=<code>`. Explain the ones a
// person can act on; never echo the raw value.
const errors: Record<string, string> = {
	account_not_linked:
		"That email already belongs to an account signed in another way. Sign in with that method, then link this one from your account page.",
	account_already_linked_to_different_user: "That sign-in already belongs to a different account.",
	unable_to_link_account: "That sign-in could not be linked. Each account links one of each provider.",
};

function Problem(props: { error?: string }) {
	if (!props.error) return null;
	return (
		<p class="note" role="alert">
			{errors[props.error] ?? "Sign-in did not finish. Please try again."}
		</p>
	);
}

function Panel(props: { title: string; children: Child }) {
	return (
		<section class="ql-panel panel">
			<h2>{props.title}</h2>
			{props.children}
		</section>
	);
}

// The passkey script's result line, and the fallback without JavaScript.
function PasskeyStatus() {
	return (
		<>
			<p id="passkey-status" class="muted" role="status" aria-live="polite"></p>
			<noscript>
				<p class="muted">Passkeys need JavaScript.</p>
			</noscript>
			<script src="/passkey.js" defer></script>
		</>
	);
}

export function SignInPage(props: { providers: Provider[]; next: string; error?: string }) {
	return (
		<section class="wrap docs">
			<h1>Sign in</h1>
			<Problem error={props.error} />
			<Panel title="Choose a method">
				{props.providers.map((provider, i) => (
					<form method="post" action="/sign-in">
						<input type="hidden" name="provider" value={provider} />
						<input type="hidden" name="next" value={props.next} />
						<p>
							<button class={`button ${i === 0 ? "primary" : "quiet"}`}>
								Sign in with {providerNames[provider]}
							</button>
						</p>
					</form>
				))}
				<p>
					<button class="button quiet" type="button" data-passkey="sign-in" data-next={props.next} hidden>
						Sign in with a passkey
					</button>
				</p>
				<PasskeyStatus />
				<p class="muted note-small">
					Acting on a repository needs a linked GitHub account; other methods sign in to the same account once
					linked from your account page.
				</p>
			</Panel>
		</section>
	);
}

export function AccountPage(props: {
	name: string;
	linked: Provider[];
	providers: Provider[];
	passkeys: Passkey[];
	/** The VAPID public key, or null where notifications are not configured. */
	notifications: string | null;
	devices: number;
	error?: string;
}) {
	const unlinked = props.providers.filter((provider) => !props.linked.includes(provider));
	return (
		<section class="wrap docs">
			<h1>Account</h1>
			<p class="muted">Signed in as {props.name}.</p>
			<Problem error={props.error} />
			<Panel title="Sign-in methods">
				<ul>
					{props.linked.map((provider) => (
						<li>{providerNames[provider]}</li>
					))}
				</ul>
				{props.linked.includes("github") ? (
					<p class="muted">Repository access comes from your linked GitHub account.</p>
				) : (
					<p class="muted">Link GitHub to act on repositories you maintain.</p>
				)}
				{unlinked.map((provider) => (
					<form method="post" action="/link">
						<input type="hidden" name="provider" value={provider} />
						<p>
							<button class="button quiet">Link {providerNames[provider]}</button>
						</p>
					</form>
				))}
			</Panel>
			<Panel title="Passkeys">
				{props.passkeys.length ? (
					<ul>
						{props.passkeys.map((key) => (
							<li>
								{key.name || "Passkey"}
								{key.createdAt && (
									<span class="muted">
										{" "}
										added {new Date(key.createdAt).toISOString().slice(0, 10)}
									</span>
								)}
								<form method="post" action="/passkeys/delete">
									<input type="hidden" name="id" value={key.id} />
									<button class="button quiet">Remove</button>
								</form>
							</li>
						))}
					</ul>
				) : (
					<p class="muted">No passkeys yet.</p>
				)}
				<p>
					<button class="button quiet" type="button" data-passkey="add" hidden>
						Add a passkey
					</button>
				</p>
				<PasskeyStatus />
				<p class="muted note-small">
					Keep another passkey or a linked provider to recover access; there is no administrator recovery.
				</p>
			</Panel>
			{props.notifications && (
				<Panel title="Notifications">
					<p>
						Get a notification when something needs your decision: an agent's question, an account limit, a
						stopped job, a new issue, or a pull request ready for review. Tapping it opens the decision.
					</p>
					<p class="muted">
						{props.devices === 1
							? "1 device is notified."
							: `${props.devices || "No"} devices are notified.`}{" "}
						Signing out turns notifications off for that device.
					</p>
					<Notifications publicKey={props.notifications} />
					<noscript>
						<p class="muted">Notifications need JavaScript.</p>
					</noscript>
				</Panel>
			)}
		</section>
	);
}
