import { afterEach, describe, expect, test } from "bun:test";
import { refreshAccountUsage } from "../../src/core/usage";
import { openaiUsageService } from "../../src/core/usage/providers/openai";

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe("openai usage service", () => {
    test("returns exact ChatGPT usage for oauth auth", async () => {
        let requestedURL = "";
        let authorization = "";
        let accountID = "";
        globalThis.fetch = (async (input, init) => {
            requestedURL = String(input);
            const headers = init?.headers as Record<string, string>;
            authorization = String(headers.Authorization);
            accountID = String(headers["ChatGPT-Account-Id"]);
            return Response.json({
                plan_type: "plus",
                rate_limit: {
                    allowed: true,
                    limit_reached: false,
                    primary_window: {
                        used_percent: 29,
                        reset_at: 1_780_785_699,
                        limit_window_seconds: 18_000,
                    },
                    secondary_window: {
                        used_percent: 53,
                        reset_at: 1_781_283_144,
                        limit_window_seconds: 604_800,
                    },
                },
                credits: {
                    has_credits: false,
                    unlimited: false,
                    balance: "0",
                },
            });
        }) as typeof fetch;

        const accessPayload = Buffer.from(
            JSON.stringify({
                "https://api.openai.com/auth": {
                    chatgpt_account_id: "acct-test",
                },
            }),
        ).toString("base64url");

        const snapshot = await openaiUsageService.refreshUsage({
            providerID: "openai",
            alias: "oauth",
            auth: { type: "oauth", refresh: "refresh", access: `header.${accessPayload}.sig`, expires: 1 },
            authType: "oauth",
            createdAt: 1,
            updatedAt: 1,
            failures: 0,
            disabled: false,
        });

        expect(requestedURL).toBe("https://chatgpt.com/backend-api/wham/usage");
        expect(authorization).toStartWith("Bearer header.");
        expect(accountID).toBe("acct-test");
        expect(snapshot.confidence).toBe("exact");
        expect(snapshot.planName).toBe("ChatGPT Plus");
        expect(snapshot.usedPercent).toBe(29);
        expect(snapshot.resetAt).toBe(1_780_785_699_000);
        expect(snapshot.message).toBe("OpenAI ChatGPT usage fetched.");
    });

    test("returns unavailable with HTTP status when usage request fails", async () => {
        let requestedURL = "";
        let authorization = "";
        globalThis.fetch = (async (input, init) => {
            requestedURL = String(input);
            authorization = String((init?.headers as Record<string, string>).Authorization);
            return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
        }) as typeof fetch;

        const snapshot = await openaiUsageService.refreshUsage({
            providerID: "openai",
            alias: "work",
            auth: { type: "api", key: "sk-openai" },
            authType: "api",
            createdAt: 1,
            updatedAt: 1,
            failures: 0,
            disabled: false,
        });

        expect(requestedURL).toStartWith("https://api.openai.com/v1/organization/usage/completions");
        expect(requestedURL).toContain("bucket_width=1d");
        expect(authorization).toBe("Bearer sk-openai");
        expect(snapshot.confidence).toBe("unavailable");
        expect(snapshot.message).toContain("HTTP 403");
    });

    test("returns exact usage with redacted raw payload for api auth", async () => {
        const responseBody = {
            data: [
                {
                    input_tokens: 10,
                    output_tokens: 5,
                    metadata: {
                        access_token: "provider-returned-token",
                        key: "sk-openai",
                        safe: "keep",
                    },
                    values: ["sk-openai", "safe"],
                },
            ],
        };
        let requestedURL = "";
        let authorization = "";
        globalThis.fetch = (async (input, init) => {
            requestedURL = String(input);
            authorization = String((init?.headers as Record<string, string>).Authorization);
            return Response.json(responseBody, { status: 200 });
        }) as typeof fetch;

        const snapshot = await openaiUsageService.refreshUsage({
            providerID: "openai",
            alias: "work",
            auth: { type: "api", key: "sk-openai" },
            authType: "api",
            createdAt: 1,
            updatedAt: 1,
            failures: 0,
            disabled: false,
        });

        expect(requestedURL).toStartWith("https://api.openai.com/v1/organization/usage/completions");
        expect(requestedURL).toContain("bucket_width=1d");
        expect(authorization).toBe("Bearer sk-openai");
        expect(snapshot.confidence).toBe("exact");
        expect(snapshot.rawRedacted).toEqual({
            data: [
                {
                    input_tokens: 10,
                    output_tokens: 5,
                    metadata: {
                        access_token: "[redacted]",
                        key: "[redacted]",
                        safe: "keep",
                    },
                    values: ["[redacted]", "safe"],
                },
            ],
        });
    });
});

describe("usage service registry", () => {
    test("returns unavailable for unsupported providers", async () => {
        const snapshot = await refreshAccountUsage({
            providerID: "unknown",
            alias: "main",
            auth: { type: "api", key: "key" },
            authType: "api",
            createdAt: 1,
            updatedAt: 1,
            failures: 0,
            disabled: false,
        });

        expect(snapshot.confidence).toBe("unavailable");
        expect(snapshot.message).toBe("No usage service registered for unknown.");
    });
});
