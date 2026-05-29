import {
    authPath,
    captureAuth,
    isAuthInfo,
    now,
    readNativeAuth,
    showToast,
    state,
} from "./core";

export function startAuthWatcher(client: any) {
    if (state.watchStarted) return;
    state.watchStarted = true;
    void readNativeAuth().then((auth) => {
        state.lastAuthSnapshot = auth;
    });
    const path = authPath();
    const handleChange = async () => {
        const next = await readNativeAuth();
        for (const [providerID, auth] of Object.entries(next)) {
            if (!isAuthInfo(auth)) continue;
            const suppressedUntil =
                state.suppressAuthCaptureUntil.get(providerID) ?? 0;
            if (suppressedUntil > now()) continue;
            const previous = JSON.stringify(
                state.lastAuthSnapshot[providerID] ?? null,
            );
            const current = JSON.stringify(auth);
            if (previous === current) continue;
            await captureAuth(providerID, auth, "auth-file");
            await showToast(
                client,
                `Balancer: new ${providerID} connection detected. Use /balancer alias <name>.`,
                "info",
            );
        }
        state.lastAuthSnapshot = next;
    };
    const timer = setInterval(() => void handleChange(), 1_000);
    (timer as { unref?: () => void }).unref?.();
}
