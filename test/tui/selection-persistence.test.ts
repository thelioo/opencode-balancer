import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (file: string) =>
	readFileSync(join(import.meta.dir, "../../src/tui/components", file), "utf8");

// When the plugin is installed from npm, opentui's runtime bridge can make
// opencode's reactive computation track the signals these screens read while
// mounting. Every cursor move then re-renders the route and remounts the
// component, so selection state kept inside the component resets to the top
// on each key press (arrow navigation appears dead). Keeping the selection
// signals at module scope makes the screens remount-proof.
describe("selection state survives route remounts", () => {
	test("dashboard selection signals live at module scope", () => {
		const source = read("dashboard.tsx");
		const componentStart = source.indexOf("export function Dashboard(");
		expect(componentStart).toBeGreaterThan(0);

		for (const signal of [
			"const [cursor, setCursor] = createSignal(",
			"const [headerCursor, setHeaderCursor] = createSignal(",
			"const [focusArea, setFocusArea] = createSignal<DashboardFocusArea>(",
			"const [confirmAccount, setConfirmAccount] = createSignal<",
		]) {
			const index = source.indexOf(signal);
			expect(index).toBeGreaterThan(0);
			expect(index).toBeLessThan(componentStart);
		}
	});

	test("priority screen selection signals live at module scope", () => {
		const source = read("priority-screen.tsx");
		const componentStart = source.indexOf("export function PriorityScreen(");
		expect(componentStart).toBeGreaterThan(0);

		for (const signal of [
			"const [cursor, setCursor] = createSignal(",
			"const [focusArea, setFocusArea] = createSignal<PriorityFocusArea>(",
		]) {
			const index = source.indexOf(signal);
			expect(index).toBeGreaterThan(0);
			expect(index).toBeLessThan(componentStart);
		}
	});
});
