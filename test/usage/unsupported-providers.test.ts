import { describe, expect, test } from "bun:test";
import { refreshAccountUsage } from "../../src/core/usage";

describe("unsupported usage providers", () => {
	test("does not register Anthropic or Google usage providers", async () => {
		for (const providerID of ["anthropic", "google", "gemini"]) {
			const snapshot = await refreshAccountUsage({
				alias: "work",
				auth: { key: "test-key", type: "api" },
				authType: "api",
				createdAt: 1,
				disabled: false,
				failures: 0,
				providerID,
				updatedAt: 1,
			});

			expect(snapshot).toMatchObject({
				alias: "work",
				confidence: "unavailable",
				message: `No usage service registered for ${providerID}.`,
				providerID,
			});
		}
	});
});
