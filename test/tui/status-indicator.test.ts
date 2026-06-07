import { describe, expect, test } from "bun:test";
import { formatBalancerStatus } from "../../src/tui/status-format";

describe("formatBalancerStatus", () => {
    test("shows the selected account when it matches the session provider", () => {
        expect(
            formatBalancerStatus({
                selected: { providerID: "openai", alias: "op1" },
                sessionActive: { providerID: "openai", alias: "op1" },
                sessionProviderID: "openai",
            }),
        ).toBe("openai/op1");
    });

    test("prefers the explicitly selected account over a stale session provider when balancing is off", () => {
        expect(
            formatBalancerStatus({
                selected: { providerID: "openai", alias: "op1" },
                sessionActive: { providerID: "github-copilot", alias: "gh1" },
                sessionProviderID: "github-copilot",
            }),
        ).toBe("openai/op1");
    });

    test("shows the active account when priority balancing is enabled", () => {
        expect(
            formatBalancerStatus({
                selected: { providerID: "openai", alias: "op1" },
                balancing: { providerID: "github-copilot", alias: "gh1", modelID: "gemini-2.5-pro" },
            }),
        ).toBe("github-copilot/gh1");
    });

    test("includes compact usage when available", () => {
        expect(
            formatBalancerStatus({
                balancing: { providerID: "github-copilot", modelID: "gemini-2.5-pro" },
                usage: "██░░ 25%",
            }),
        ).toBe("github-copilot · ██░░ 25%");
    });
});
