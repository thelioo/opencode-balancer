import { describe, expect, test } from "bun:test";
import { formatBalancerStatus } from "../../src/tui/status-format";

describe("formatBalancerStatus", () => {
	test("shows the selected account when it matches the session provider", () => {
		expect(
			formatBalancerStatus({
				selected: { alias: "op1", providerID: "openai" },
				sessionActive: { alias: "op1", providerID: "openai" },
				sessionProviderID: "openai",
			}),
		).toBe("openai/op1");
	});

	test("prefers the explicitly selected account over a stale session provider when balancing is off", () => {
		expect(
			formatBalancerStatus({
				selected: { alias: "op1", providerID: "openai" },
				sessionActive: { alias: "gh1", providerID: "github-copilot" },
				sessionProviderID: "github-copilot",
			}),
		).toBe("openai/op1");
	});

	test("shows the active account when priority balancing is enabled", () => {
		expect(
			formatBalancerStatus({
				balancing: {
					alias: "gh1",
					modelID: "gemini-2.5-pro",
					providerID: "github-copilot",
				},
				selected: { alias: "op1", providerID: "openai" },
			}),
		).toBe("github-copilot/gh1");
	});

	test("includes compact usage when available", () => {
		expect(
			formatBalancerStatus({
				balancing: { modelID: "gemini-2.5-pro", providerID: "github-copilot" },
				usage: "██░░ 25%",
			}),
		).toBe("github-copilot · ██░░ 25%");
	});
});
