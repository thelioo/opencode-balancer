import {
    BALANCER_ALIAS_INPUT,
    applyAuthToHeaders,
    captureAuth,
    cloneRequestInput,
    fakeCommandResponse,
    headersFrom,
    INTERNAL_REQUEST_HEADER,
    isAuthInfo,
    isInternalUrl,
    markRateLimited,
    markUsed,
    maybeInjectAliasPrompt,
    nextAvailableAccount,
    normalizeAlias,
    now,
    parseAuthSetProvider,
    parseJsonBody,
    parseProviderAuthorize,
    parseProviderCallback,
    parseSessionCommand,
    parseUrl,
    readNativeAuth,
    readStore,
    RETRYABLE_STATUS,
    retryAfterMs,
    saveAccount,
    setNativeAuth,
    showToast,
    state,
    writeStore,
} from "./core";
import { runBalancerCommand } from "./commands";
import type { Account } from "./core";

export async function installFetchPatch(client: any) {
    if (state.fetchPatched) return;
    state.fetchPatched = true;
    const originalFetch = globalThis.fetch.bind(globalThis);

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = parseUrl(input);

        const commandSessionID = parseSessionCommand(url);
        if (
            commandSessionID &&
            (init?.method ?? "GET").toUpperCase() === "POST"
        ) {
            const body = parseJsonBody(init);
            if (body?.command === "balancer") {
                const result = await runBalancerCommand(
                    client,
                    typeof body.arguments === "string" ? body.arguments : "",
                );
                await showToast(client, result.split("\n")[0] ?? result, "info");
                return new Response(
                    JSON.stringify(fakeCommandResponse(commandSessionID, result)),
                    {
                        status: 200,
                        headers: { "content-type": "application/json" },
                    },
                );
            }
        }

        if (isInternalUrl(url) && url?.pathname === "/provider/auth") {
            return maybeInjectAliasPrompt(await originalFetch(input, init));
        }

        const authorizeProvider = parseProviderAuthorize(url);
        if (
            authorizeProvider &&
            (init?.method ?? "GET").toUpperCase() === "POST"
        ) {
            const body = parseJsonBody(init);
            const alias =
                typeof body?.inputs?.[BALANCER_ALIAS_INPUT] === "string"
                    ? normalizeAlias(body.inputs[BALANCER_ALIAS_INPUT])
                    : "";
            if (alias) state.pendingOauthAlias.set(authorizeProvider, alias);
            if (body?.inputs && BALANCER_ALIAS_INPUT in body.inputs) {
                delete body.inputs[BALANCER_ALIAS_INPUT];
                init = { ...init, body: JSON.stringify(body) };
            }
            return originalFetch(input, init);
        }

        const callbackProvider = parseProviderCallback(url);
        if (
            callbackProvider &&
            (init?.method ?? "GET").toUpperCase() === "POST"
        ) {
            const response = await originalFetch(input, init);
            const alias = state.pendingOauthAlias.get(callbackProvider);
            if (response.ok && alias) {
                setTimeout(async () => {
                    const auth = (await readNativeAuth())[callbackProvider];
                    if (isAuthInfo(auth)) {
                        await saveAccount(callbackProvider, alias, auth);
                        await showToast(
                            client,
                            `Balancer: account ${callbackProvider}/${alias} saved.`,
                            "success",
                        );
                    }
                    state.pendingOauthAlias.delete(callbackProvider);
                }, 250);
            }
            return response;
        }

        const authSetProvider = parseAuthSetProvider(url);
        if (
            authSetProvider &&
            (init?.method ?? "GET").toUpperCase() === "PUT"
        ) {
            const body = parseJsonBody(init);
            const response = await originalFetch(input, init);
            if (response.ok && isAuthInfo(body)) {
                const suppressedUntil =
                    state.suppressAuthCaptureUntil.get(authSetProvider) ?? 0;
                if (suppressedUntil <= now()) {
                    await captureAuth(authSetProvider, body, "http");
                    await showToast(
                        client,
                        `Balancer: ${authSetProvider} connection detected. Use /balancer alias <name>.`,
                        "info",
                    );
                }
            }
            return response;
        }

        const headers = headersFrom(input, init);
        const requestID = headers.get(INTERNAL_REQUEST_HEADER);
        if (!requestID) return originalFetch(input, init);

        const pending = state.pendingRequests.get(requestID);
        headers.delete(INTERNAL_REQUEST_HEADER);

        if (!pending?.account) {
            const [nextInput, nextInit] = cloneRequestInput(
                input,
                init,
                headers,
            );
            return originalFetch(nextInput, nextInit);
        }

        let account: Account = pending.account;
        let attempt = 0;
        while (true) {
            attempt++;
            const attemptHeaders = new Headers(headers);
            applyAuthToHeaders(attemptHeaders, account);
            const [nextInput, nextInit] = cloneRequestInput(
                input,
                init,
                attemptHeaders,
            );
            const response = await originalFetch(nextInput, nextInit);
            if (!RETRYABLE_STATUS.has(response.status)) {
                await markUsed(account.providerID, account.alias);
                return response;
            }

            await markRateLimited(
                account.providerID,
                account.alias,
                retryAfterMs(response),
            );
            const next = await nextAvailableAccount(
                account.providerID,
                account.alias,
            );
            if (!next || attempt >= 3) return response;

            account = next;
            const store = await readStore();
            const provider = store.providers[account.providerID];
            if (provider) {
                provider.active = account.alias;
                await writeStore(store);
            }
            await setNativeAuth(client, account.providerID, account.auth);
            await showToast(
                client,
                `Balancer: ${pending.providerID}/${pending.account.alias} is rate limited. Switching to ${account.alias}.`,
                "warning",
            );
        }
    }) as typeof globalThis.fetch;
}
