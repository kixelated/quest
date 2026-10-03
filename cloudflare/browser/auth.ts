import { createAuthClient } from "better-auth/client";
import { passkeyClient } from "@better-auth/passkey/client";
const auth = createAuthClient({ plugins: [passkeyClient()] });
const status = document.querySelector<HTMLElement>("#auth-status")!;
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-auth-action]")) {
	button.addEventListener("click", async () => {
		button.disabled = true;
		status.textContent = "";
		try {
			const action = button.dataset.authAction;
			const result =
				action === "passkey-sign-in"
					? await auth.signIn.passkey()
					: action === "passkey-add"
						? await auth.passkey.addPasskey({ name: "Quest passkey" })
						: action === "passkey-delete"
							? await auth.passkey.deletePasskey({ id: button.dataset.id! })
							: await auth.linkSocial({
									provider: button.dataset.provider as "github" | "google",
									callbackURL: "/account",
								});
			if (result.error) status.textContent = result.error.message ?? "Authentication failed. Please try again.";
			else window.location.assign(action === "passkey-sign-in" ? "/" : "/account");
		} catch {
			status.textContent = "Authentication did not finish. Please try again.";
		} finally {
			button.disabled = false;
		}
	});
}
