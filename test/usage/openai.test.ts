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
				credits: {
					balance: "0",
					has_credits: false,
					unlimited: false,
				},
				plan_type: "plus",
				rate_limit: {
					allowed: true,
					limit_reached: false,
					primary_window: {
						limit_window_seconds: 18_000,
						reset_at: 1_780_785_699,
						used_percent: 29,
					},
					secondary_window: {
						limit_window_seconds: 604_800,
						reset_at: 1_781_283_144,
						used_percent: 53,
					},
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
			alias: "oauth",
			auth: {
				access: `header.${accessPayload}.sig`,
				expires: 1,
				refresh: "refresh",
				type: "oauth",
			},
			authType: "oauth",
			createdAt: 1,
			disabled: false,
			failures: 0,
			providerID: "openai",
			updatedAt: 1,
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
			authorization = String(
				(init?.headers as Record<string, string>).Authorization,
			);
			return new Response(JSON.stringify({ error: "forbidden" }), {
				status: 403,
			});
		}) as typeof fetch;

		const snapshot = await openaiUsageService.refreshUsage({
			alias: "work",
			auth: { key: "sk-openai", type: "api" },
			authType: "api",
			createdAt: 1,
			disabled: false,
			failures: 0,
			providerID: "openai",
			updatedAt: 1,
		});

		expect(requestedURL).toStartWith(
			"https://api.openai.com/v1/organization/usage/completions",
		);
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
					metadata: {
						access_token: "provider-returned-token",
						key: "sk-openai",
						safe: "keep",
					},
					output_tokens: 5,
					values: ["sk-openai", "safe"],
				},
			],
		};
		let requestedURL = "";
		let authorization = "";
		globalThis.fetch = (async (input, init) => {
			requestedURL = String(input);
			authorization = String(
				(init?.headers as Record<string, string>).Authorization,
			);
			return Response.json(responseBody, { status: 200 });
		}) as typeof fetch;

		const snapshot = await openaiUsageService.refreshUsage({
			alias: "work",
			auth: { key: "sk-openai", type: "api" },
			authType: "api",
			createdAt: 1,
			disabled: false,
			failures: 0,
			providerID: "openai",
			updatedAt: 1,
		});

		expect(requestedURL).toStartWith(
			"https://api.openai.com/v1/organization/usage/completions",
		);
		expect(requestedURL).toContain("bucket_width=1d");
		expect(authorization).toBe("Bearer sk-openai");
		expect(snapshot.confidence).toBe("exact");
		expect(snapshot.rawRedacted).toEqual({
			data: [
				{
					input_tokens: 10,
					metadata: {
						access_token: "[redacted]",
						key: "[redacted]",
						safe: "keep",
					},
					output_tokens: 5,
					values: ["[redacted]", "safe"],
				},
			],
		});
	});
});

describe("usage service registry", () => {
	test("returns unavailable for unsupported providers", async () => {
		const snapshot = await refreshAccountUsage({
			alias: "main",
			auth: { key: "key", type: "api" },
			authType: "api",
			createdAt: 1,
			disabled: false,
			failures: 0,
			providerID: "unknown",
			updatedAt: 1,
		});

		expect(snapshot.confidence).toBe("unavailable");
		expect(snapshot.message).toBe("No usage service registered for unknown.");
	});
});
