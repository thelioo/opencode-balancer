import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("BalancerSidebar", () => {
    test("renders account activation as a clickable box row", () => {
        const source = readFileSync(join(import.meta.dir, "../../src/tui/components/sidebar.tsx"), "utf8");

        expect(source).toContain(
            '<box flexDirection="column" gap={0} onMouseUp={() => props.activateAccount(account.providerID, account.alias)}>',
        );
    });

    test("renders balancing on/off state in the sidebar header", () => {
        const source = readFileSync(join(import.meta.dir, "../../src/tui/components/sidebar.tsx"), "utf8");

        expect(source).toContain("getBalancingEnabled");
        expect(source).toContain('<text fg={theme().text} wrapMode="none">');
        expect(source).toContain("Balancer");
        expect(source).toContain('{balancingEnabled() ? "ON" : "OFF"}');
        expect(source).not.toContain('balancer {balancingEnabled() ? "on" : "off"}');
        expect(source).not.toContain('paddingLeft={1} paddingRight={1}');
    });

    test("does not render pending auth prompts", () => {
        const source = readFileSync(join(import.meta.dir, "../../src/tui/components/sidebar.tsx"), "utf8");

        expect(source).not.toContain("listPendingConnections");
        expect(source).not.toContain("Pending");
    });
});
