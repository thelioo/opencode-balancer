import { describe, expect, test } from "bun:test";
import { refreshAccountUsage } from "../../src/core/usage";

describe("unsupported usage providers", () => {
    test("does not register Anthropic or Google usage providers", async () => {
        for (const providerID of ["anthropic", "google", "gemini"]) {
            const snapshot = await refreshAccountUsage({
                providerID,
                alias: "work",
                auth: { type: "api", key: "test-key" },
                authType: "api",
                createdAt: 1,
                updatedAt: 1,
                failures: 0,
                disabled: false,
            });

            expect(snapshot).toMatchObject({
                providerID,
                alias: "work",
                confidence: "unavailable",
                message: `No usage service registered for ${providerID}.`,
            });
        }
    });
});
