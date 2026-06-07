import { afterEach, describe, expect, test } from "bun:test";
import { copilotUsageService } from "../../src/core/usage/providers/copilot";

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe("copilot usage service", () => {
    test("returns unavailable when github org metadata is missing", async () => {
        let called = false;
        globalThis.fetch = (async () => {
            called = true;
            return new Response(null, { status: 200 });
        }) as typeof fetch;

        const snapshot = await copilotUsageService.refreshUsage({
            providerID: "github-copilot",
            alias: "work",
            auth: { type: "oauth", refresh: "refresh", access: "gho-token", expires: 1 },
            authType: "oauth",
            createdAt: 1,
            updatedAt: 1,
            failures: 0,
            disabled: false,
        });

        expect(called).toBe(true);
        expect(snapshot.confidence).toBe("unavailable");
        expect(snapshot.message).toContain("personal billing usage");
    });

    test("returns unavailable for non-oauth auth even when github org metadata exists", async () => {
        let called = false;
        globalThis.fetch = (async () => {
            called = true;
            return new Response(null, { status: 200 });
        }) as typeof fetch;

        const snapshot = await copilotUsageService.refreshUsage({
            providerID: "github-copilot",
            alias: "work",
            auth: { type: "api", key: "copilot-api-key", metadata: { githubOrg: "acme" } },
            authType: "api",
            createdAt: 1,
            updatedAt: 1,
            failures: 0,
            disabled: false,
        });

        expect(called).toBe(false);
        expect(snapshot.confidence).toBe("unavailable");
        expect(snapshot.message).toContain("OAuth auth");
    });

    test("returns exact billing data for oauth auth with github org", async () => {
        const responseBody = {
            plan_type: "business",
            secrets: {
                access_token: "gho-token",
                refresh_token: "rfr-abc123",
                token: "provider-token",
                note: "embedded gho-token is sensitive",
            },
            nested: {
                child: {
                    "prefix-rfr-abc123-suffix": "safe",
                },
            },
            values: ["gho-token", "prefix-rfr-abc123-suffix", "business"],
        };
        let requestedURL = "";
        let authorization = "";
        let accept = "";
        let apiVersion = "";
        globalThis.fetch = (async (input, init) => {
            requestedURL = String(input);
            const headers = init?.headers as Record<string, string>;
            authorization = headers.Authorization;
            accept = headers.Accept;
            apiVersion = headers["X-GitHub-Api-Version"];
            return Response.json(responseBody, { status: 200 });
        }) as typeof fetch;

        const snapshot = await copilotUsageService.refreshUsage({
            providerID: "github-copilot",
            alias: "work",
            auth: {
                type: "oauth",
                refresh: "rfr-abc123",
                access: "gho-token",
                expires: 1,
                metadata: { githubOrg: "acme" },
            },
            authType: "oauth",
            createdAt: 1,
            updatedAt: 1,
            failures: 0,
            disabled: false,
        });

        expect(requestedURL).toBe("https://api.github.com/orgs/acme/copilot/billing");
        expect(authorization).toBe("Bearer gho-token");
        expect(accept).toBe("application/vnd.github+json");
        expect(apiVersion).toBe("2026-03-10");
        expect(snapshot.confidence).toBe("exact");
        expect(snapshot.planName).toBe("business");
        expect(snapshot.rawRedacted).toEqual({
            plan_type: "business",
            secrets: {
                access_token: "[redacted]",
                refresh_token: "[redacted]",
                token: "[redacted]",
                note: "embedded [redacted] is sensitive",
            },
            nested: {
                child: {
                    "prefix-[redacted]-suffix": "safe",
                },
            },
            values: ["[redacted]", "prefix-[redacted]-suffix", "business"],
        });
    });

    test("returns personal premium request usage for oauth auth without github org", async () => {
        const requestedURLs: string[] = [];
        globalThis.fetch = (async (input, init) => {
            requestedURLs.push(String(input));
            expect(String((init?.headers as Record<string, string>).Authorization)).toBe("Bearer gho-token");

            if (String(input) === "https://api.github.com/copilot_internal/user") {
                return Response.json(
                    {
                        login: "octocat",
                        copilot_plan: "individual",
                        quota_snapshots: {
                            premium_interactions: {
                                entitlement: 100,
                                remaining: 88,
                                percent_remaining: 88,
                            },
                        },
                    },
                    { status: 200 },
                );
            }
            return new Response(null, { status: 404 });
        }) as typeof fetch;

        const snapshot = await copilotUsageService.refreshUsage({
            providerID: "github-copilot",
            alias: "personal",
            auth: { type: "oauth", refresh: "refresh", access: "gho-token", expires: 1 },
            authType: "oauth",
            createdAt: 1,
            updatedAt: 1,
            failures: 0,
            disabled: false,
        });

        expect(requestedURLs).toEqual([
            "https://api.github.com/copilot_internal/user",
        ]);
        expect(snapshot.confidence).toBe("exact");
        expect(snapshot.usedTokens).toBe(12);
        expect(snapshot.remainingTokens).toBe(88);
        expect(snapshot.message).toBe("GitHub Copilot personal quota fetched for octocat (individual)." );
    });

    test("falls back to personal billing usage summary when premium request usage is unavailable", async () => {
        const requestedURLs: string[] = [];
        globalThis.fetch = (async (input) => {
            requestedURLs.push(String(input));
            if (String(input) === "https://api.github.com/copilot_internal/user") return new Response(null, { status: 404 });
            if (String(input) === "https://api.github.com/user") return Response.json({ login: "octocat" });
            if (String(input) === "https://api.github.com/users/octocat/settings/billing/premium_request/usage") {
                return new Response(null, { status: 404 });
            }
            if (String(input) === "https://api.github.com/users/octocat/settings/billing/usage/summary?product=copilot") {
                return Response.json({ usageItems: [{ product: "Copilot", sku: "copilot", netQuantity: 3 }] });
            }
            return new Response(null, { status: 404 });
        }) as typeof fetch;

        const snapshot = await copilotUsageService.refreshUsage({
            providerID: "github-copilot",
            alias: "personal",
            auth: { type: "oauth", refresh: "refresh", access: "gho-token", expires: 1 },
            authType: "oauth",
            createdAt: 1,
            updatedAt: 1,
            failures: 0,
            disabled: false,
        });

        expect(requestedURLs).toEqual([
            "https://api.github.com/copilot_internal/user",
            "https://api.github.com/user",
            "https://api.github.com/users/octocat/settings/billing/premium_request/usage",
            "https://api.github.com/users/octocat/settings/billing/usage/summary?product=copilot",
        ]);
        expect(snapshot.confidence).toBe("exact");
        expect(snapshot.usedTokens).toBe(3);
        expect(snapshot.message).toBe("GitHub Copilot personal billing usage fetched for octocat.");
    });

    test("returns unavailable with HTTP status when billing request fails", async () => {
        let requestedURL = "";
        let authorization = "";
        globalThis.fetch = (async (input, init) => {
            requestedURL = String(input);
            authorization = String((init?.headers as Record<string, string>).Authorization);
            return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
        }) as typeof fetch;

        const snapshot = await copilotUsageService.refreshUsage({
            providerID: "github-copilot",
            alias: "work",
            auth: {
                type: "oauth",
                refresh: "refresh",
                access: "gho-token",
                expires: 1,
                metadata: { githubOrg: "acme" },
            },
            authType: "oauth",
            createdAt: 1,
            updatedAt: 1,
            failures: 0,
            disabled: false,
        });

        expect(requestedURL).toBe("https://api.github.com/orgs/acme/copilot/billing");
        expect(authorization).toBe("Bearer gho-token");
        expect(snapshot.confidence).toBe("unavailable");
        expect(snapshot.message).toContain("HTTP 403");
    });
});
