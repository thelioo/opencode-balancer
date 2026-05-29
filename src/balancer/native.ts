import { now, state } from "./state";
import type { AuthInfo } from "./types";

export async function setNativeAuth(
    client: any,
    providerID: string,
    auth: AuthInfo,
) {
    state.suppressAuthCaptureUntil.set(providerID, now() + 2_000);
    await client.auth
        .set({
            path: { id: providerID },
            body: auth,
        })
        .catch(() => undefined);
}

export async function showToast(
    client: any,
    message: string,
    variant: "info" | "success" | "warning" | "error" = "info",
) {
    await client.tui
        .showToast({ body: { message, variant, duration: 15_000 } })
        .catch(() => undefined);
}
