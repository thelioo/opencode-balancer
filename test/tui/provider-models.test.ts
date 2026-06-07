import { describe, expect, test } from "bun:test";
import { providerModelOptions } from "../../src/tui/provider-models";

describe("providerModelOptions", () => {
    test("returns only non-deprecated models for the requested provider", () => {
        const options = providerModelOptions(
            [
                {
                    id: "openai",
                    name: "OpenAI",
                    models: {
                        "gpt-5.5": { id: "gpt-5.5", name: "GPT-5.5", release_date: "2026-01-01" },
                    },
                },
                {
                    id: "github-copilot",
                    name: "GitHub Copilot",
                    models: {
                        "claude-haiku-4.5": {
                            id: "claude-haiku-4.5",
                            name: "Claude Haiku 4.5",
                            release_date: "2026-02-01",
                        },
                        old: { id: "old", name: "Old", status: "deprecated", release_date: "2024-01-01" },
                    },
                },
            ],
            "github-copilot",
        );

        expect(options).toEqual([
            {
                modelID: "claude-haiku-4.5",
                providerID: "github-copilot",
                providerName: "GitHub Copilot",
                title: "Claude Haiku 4.5",
            },
        ]);
    });
});
