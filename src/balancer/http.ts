import {
    BALANCER_ALIAS_INPUT,
    BALANCER_METADATA_KEY,
    now,
} from "./state";
import type { Account } from "./types";

function getHeaderEntries(headers: Headers) {
    return Array.from(headers.entries()).map(
        ([key, value]) => [key.toLowerCase(), value] as const,
    );
}

export function applyAuthToHeaders(headers: Headers, account: Account) {
    const auth = account.auth;
    const entries = getHeaderEntries(headers);

    if (auth.type === "oauth") {
        if (auth.access) headers.set("authorization", `Bearer ${auth.access}`);
        return;
    }

    if (auth.type === "wellknown") {
        if (headers.has("authorization"))
            headers.set("authorization", `Bearer ${auth.token}`);
        else headers.set(auth.key, auth.token);
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
        if (name === "authorization") {
            headers.set(
                name,
                current.toLowerCase().startsWith("bearer ")
                    ? `Bearer ${auth.key}`
                    : auth.key,
            );
        } else {
            headers.set(name, auth.key);
        }
        changed = true;
    }

    if (!changed) headers.set("authorization", `Bearer ${auth.key}`);
}

export function cloneRequestInput(
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    headers: Headers,
): [RequestInfo | URL, RequestInit | undefined] {
    if (typeof Request !== "undefined" && input instanceof Request) {
        return [new Request(input, { ...init, headers }), undefined];
    }
    return [input, { ...init, headers }];
}

export function parseUrl(input: RequestInfo | URL): URL | undefined {
    try {
        if (typeof input === "string")
            return new URL(input, "http://localhost");
        if (input instanceof URL) return input;
        if (typeof Request !== "undefined" && input instanceof Request)
            return new URL(input.url);
    } catch {}
    return undefined;
}

export function headersFrom(input: RequestInfo | URL, init?: RequestInit) {
    if (init?.headers) return new Headers(init.headers);
    if (typeof Request !== "undefined" && input instanceof Request)
        return new Headers(input.headers);
    return new Headers();
}

function requestBodyText(init?: RequestInit) {
    const body = init?.body;
    if (typeof body === "string") return body;
    if (body instanceof URLSearchParams) return body.toString();
    return undefined;
}

export function parseJsonBody(init?: RequestInit) {
    const text = requestBodyText(init);
    if (!text) return undefined;
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}

export function isInternalUrl(url: URL | undefined) {
    if (!url) return false;
    return (
        url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.hostname === "0.0.0.0"
    );
}

export function parseAuthSetProvider(url: URL | undefined) {
    if (!url || !isInternalUrl(url)) return undefined;
    const match = url.pathname.match(/^\/auth\/([^/]+)$/);
    return match ? decodeURIComponent(match[1]) : undefined;
}

export function parseProviderAuthorize(url: URL | undefined) {
    if (!url || !isInternalUrl(url)) return undefined;
    const match = url.pathname.match(/^\/provider\/([^/]+)\/oauth\/authorize$/);
    return match ? decodeURIComponent(match[1]) : undefined;
}

export function parseProviderCallback(url: URL | undefined) {
    if (!url || !isInternalUrl(url)) return undefined;
    const match = url.pathname.match(/^\/provider\/([^/]+)\/oauth\/callback$/);
    return match ? decodeURIComponent(match[1]) : undefined;
}

export function parseSessionCommand(url: URL | undefined) {
    if (!url || !isInternalUrl(url)) return undefined;
    const match = url.pathname.match(/^\/session\/([^/]+)\/command$/);
    return match ? decodeURIComponent(match[1]) : undefined;
}

export function fakeCommandResponse(sessionID: string, text: string) {
    const created = now();
    const suffix = `${created.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const messageID = `msg_${suffix}`;
    return {
        info: {
            id: messageID,
            sessionID,
            role: "user",
            time: { created },
            agent: "build",
            model: { providerID: "opencode", modelID: "balancer-command" },
        },
        parts: [
            {
                id: `prt_${suffix}`,
                sessionID,
                messageID,
                type: "text",
                text,
                synthetic: true,
                ignored: true,
                metadata: { [BALANCER_METADATA_KEY]: true },
            },
        ],
    };
}

export async function maybeInjectAliasPrompt(response: Response) {
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.includes("application/json"))
        return response;
    try {
        const data = (await response.clone().json()) as Record<
            string,
            Array<Record<string, any>>
        >;
        for (const methods of Object.values(data)) {
            if (!Array.isArray(methods)) continue;
            for (const method of methods) {
                const prompts = Array.isArray(method.prompts)
                    ? method.prompts
                    : [];
                if (
                    prompts.some(
                        (prompt) => prompt?.key === BALANCER_ALIAS_INPUT,
                    )
                )
                    continue;
                method.prompts = [
                    ...prompts,
                    {
                        type: "text",
                        key: BALANCER_ALIAS_INPUT,
                        message: "Alias to save in the balancer (optional)",
                        placeholder: "work, personal, backup",
                    },
                ];
            }
        }
        const headers = new Headers(response.headers);
        headers.set("content-type", "application/json");
        return new Response(JSON.stringify(data), {
            status: response.status,
            statusText: response.statusText,
            headers,
        });
    } catch {
        return response;
    }
}

export function retryAfterMs(response: Response) {
    const retryAfter = response.headers.get("retry-after");
    if (!retryAfter) return 60_000;
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(1_000, seconds * 1000);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(1_000, date - now());
    return 60_000;
}
