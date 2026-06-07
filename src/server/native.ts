import type { Database } from "bun:sqlite";
import { suppressNativeAuthCapture as suppressDbNativeAuthCapture } from "../core/native-auth-suppression";
import { isNativeConnectInProgress } from "../core/native-connect";
import { now } from "../core/time";
import type { AuthInfo } from "../core/types";

const suppressAuthCaptureUntil = new Map<string, number>();

export function suppressNativeAuthCapture(
	providerID: string,
	durationMs = 2_000,
) {
	suppressAuthCaptureUntil.set(providerID, now() + durationMs);
}

export function isNativeAuthCaptureSuppressed(providerID: string) {
	const suppressedUntil = suppressAuthCaptureUntil.get(providerID) ?? 0;
	if (suppressedUntil <= now()) {
		suppressAuthCaptureUntil.delete(providerID);
		return false;
	}
	return true;
}

export async function setNativeAuth(
	client: any,
	providerID: string,
	auth: AuthInfo,
	db?: Database,
) {
	if (db && isNativeConnectInProgress(db)) return;
	suppressNativeAuthCapture(providerID);
	if (db) suppressDbNativeAuthCapture(db, providerID);
	try {
		await client.auth.set({ body: auth, path: { id: providerID } });
	} catch {}
}

export async function showToast(
	client: any,
	message: string,
	variant: "info" | "success" | "warning" | "error" = "info",
) {
	try {
		await client.tui.showToast({
			body: { duration: 15_000, message, variant },
		});
	} catch {}
}
