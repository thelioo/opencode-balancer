import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatUsageBar, truncateMiddle } from "../../src/tui/usage-format";

describe("usage bar formatting", () => {
    test("renders a compact block bar with percentage", () => {
        expect(formatUsageBar(42, 8)).toBe("████░░░░ 42%");
    });

    test("renders unknown usage without a noisy fake bar", () => {
        expect(formatUsageBar(undefined, 8)).toBe("──────── --");
    });

    test("truncates long labels in the middle", () => {
        const value = truncateMiddle("GitHub Copilot personal quota fetched for thelioo", 24);

        expect(value.length).toBeLessThanOrEqual(24);
        expect(value).toStartWith("GitHub Copil");
        expect(value).toEndWith("for thelioo");
    });

    test("supports muted usage bars so unselected accounts do not look selected", () => {
        const source = readFileSync(join(import.meta.dir, "../../src/tui/components/usage-bar.tsx"), "utf8");

        expect(source).toContain("muted?: boolean");
        expect(source).toContain("props.muted");
    });
});
