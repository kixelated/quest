// Passkey ceremonies against Better Auth's passkey endpoints, using the
// browser's WebAuthn JSON helpers so there is no client bundle. Served as
// /passkey.js; buttons stay hidden where the browser lacks passkey support.
const status = document.getElementById("passkey-status");
const supported =
	window.PublicKeyCredential &&
	PublicKeyCredential.parseCreationOptionsFromJSON &&
	PublicKeyCredential.parseRequestOptionsFromJSON;

async function call(path, body) {
	const init = body && {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	};
	const response = await fetch(`/api/auth/passkey/${path}`, init);
	const result = await response.json().catch(() => null);
	if (!response.ok) throw new Error(result?.message || "Passkey request failed.");
	return result;
}

const ceremonies = {
	async "sign-in"(button) {
		const options = await call("generate-authenticate-options");
		const publicKey = PublicKeyCredential.parseRequestOptionsFromJSON(options);
		// The plugin asks for "preferred"; the server rejects unverified sign-ins.
		publicKey.userVerification = "required";
		const credential = await navigator.credentials.get({ publicKey });
		await call("verify-authentication", { response: credential.toJSON() });
		location.assign(button.dataset.next || "/");
	},
	async add() {
		const options = await call("generate-register-options");
		const publicKey = PublicKeyCredential.parseCreationOptionsFromJSON(options);
		const credential = await navigator.credentials.create({ publicKey });
		await call("verify-registration", { response: credential.toJSON() });
		location.reload();
	},
};

for (const button of document.querySelectorAll("[data-passkey]")) {
	if (!supported) continue;
	button.hidden = false;
	button.addEventListener("click", async () => {
		button.disabled = true;
		status.textContent = "";
		try {
			await ceremonies[button.dataset.passkey](button);
		} catch (error) {
			// The browser reports cancellation and timeouts as NotAllowedError.
			status.textContent =
				error.name === "NotAllowedError"
					? "Passkey cancelled or timed out."
					: error.message || "Passkey failed.";
		} finally {
			button.disabled = false;
		}
	});
}
if (!supported && status) status.textContent = "This browser does not support passkeys.";
