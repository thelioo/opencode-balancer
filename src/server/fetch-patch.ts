import type { Database } from "bun:sqlite";
import { setActiveAccount } from "../core/accounts";
import { getBalancingEnabled } from "../core/priority";
import type { Account } from "../core/types";
import { showToast, setNativeAuth } from "./native";
import {
    chooseFailoverAccount,
    INTERNAL_REQUEST_HEADER,
    markRateLimited,
    RETRYABLE_STATUS,
    takePendingRequest,
} from "./request-balancer";

let fetchPatched = false;

function headerEntries(headers: Headers) {
    return Array.from(headers.entries()).map(
        ([key, value]) => [key.toLowerCase(), value] as const,
    );
}

function applyAuthToHeaders(headers: Headers, account: Account, options: { preserveExistingOAuth?: boolean } = {}) {
    const auth = account.auth;
    const entries = headerEntries(headers);

    if (auth.type === "oauth") {
        if (options.preserveExistingOAuth && headers.has("authorization")) return;
        headers.set("authorization", `Bearer ${auth.access}`);
        return;
    }

    if (auth.type === "wellknown") {
        if (headers.has("authorization")) {
            headers.set("authorization", `Bearer ${auth.token}`);
        } else {
            headers.set(auth.key, auth.token);
        }
        return;
    }

    const authHeaderNames = [
        "authorization",
        "x-api-key",
        "api-key",
        "x-goog-api-key",
        "x-stainless-api-key",
        "anthropic-api-key",
        "cohere-api-key",
    ];

    let changed = false;
    for (const name of authHeaderNames) {
        const current = entries.find(([key]) => key === name)?.[1];
        if (!current) continue;
        headers.set(
            name,
            name === "authorization" && current.toLowerCase().startsWith("bearer ")
                ? `Bearer ${auth.key}`
                : auth.key,
        );
        changed = true;
    }

    if (!changed) headers.set("authorization", `Bearer ${auth.key}`);
}

export function __testResetFetchPatch() {
    fetchPatched = false;
}

function headersFrom(input: RequestInfo | URL, init?: RequestInit) {
    if (init?.headers) return new Headers(init.headers);
    if (typeof Request !== "undefined" && input instanceof Request) {
        return new Headers(input.headers);
    }
    return new Headers();
}

function cloneRequestInput(
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    headers: Headers,
): [RequestInfo | URL, RequestInit | undefined] {
    if (typeof Request !== "undefined" && input instanceof Request) {
        return [new Request(input, { ...init, headers }), undefined];
    }
    return [input, { ...init, headers }];
}

function retryAfterMs(response: Response) {
    const retryAfter = response.headers.get("retry-after");
    if (!retryAfter) return 60_000;

    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(1_000, seconds * 1000);

    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(1_000, date - Date.now());

    return 60_000;
}

export function installFetchPatch(db: Database, client: any) {
    if (fetchPatched) return;
    fetchPatched = true;
    const originalFetch = globalThis.fetch.bind(globalThis);

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const headers = headersFrom(input, init);
        const requestID = headers.get(INTERNAL_REQUEST_HEADER);
        if (!requestID) return originalFetch(input, init);

        const pending = takePendingRequest(requestID);
        headers.delete(INTERNAL_REQUEST_HEADER);
        if (!pending?.account) {
            const [nextInput, nextInit] = cloneRequestInput(input, init, headers);
            return originalFetch(nextInput, nextInit);
        }

        let account = pending.account;
        const maxAttempts = 3;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const attemptHeaders = new Headers(headers);
            applyAuthToHeaders(attemptHeaders, account, { preserveExistingOAuth: attempt === 0 });
            const [nextInput, nextInit] = cloneRequestInput(input, init, attemptHeaders);
            const response = await originalFetch(nextInput, nextInit);
            if (!RETRYABLE_STATUS.has(response.status)) return response;

            markRateLimited(db, account.providerID, account.alias, retryAfterMs(response));
            if (!getBalancingEnabled(db)) return response;
            if (attempt === maxAttempts - 1) return response;

            const next = chooseFailoverAccount(db, account.providerID, account.alias);
            if (!next) return response;

            account = setActiveAccount(db, next.providerID, next.alias);
            await setNativeAuth(client, account.providerID, account.auth, db);
            await showToast(
                client,
                `Balancer: ${pending.providerID}/${pending.account.alias} is rate limited. Switching to ${account.alias}.`,
                "warning",
            );
        }

        throw new Error("Balancer retry loop exited unexpectedly");
    }) as typeof globalThis.fetch;
}
