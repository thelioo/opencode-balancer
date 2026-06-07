import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const compact = (source: string) => source.replace(/\s+/g, "");
const expectSourceToContain = (source: string, snippet: string) =>
	expect(compact(source)).toContain(compact(snippet));

describe("PriorityScreen", () => {
	test("fills selected row background across model and enabled cells", () => {
		const source = readFileSync(
			join(import.meta.dir, "../../src/tui/components/priority-screen.tsx"),
			"utf8",
		);

		expect(source).toContain(
			"backgroundColor={rowProps.selected ? selectedColors().bg : undefined}",
		);
		expectSourceToContain(
			source,
			"backgroundColor={selected() ? selectedColors().bg : undefined}",
		);
		expectSourceToContain(
			source,
			"onMouseUp={() => props.openModelPicker(entry.providerID, restoreFocus)}",
		);
		expect(source).toContain("onMouseUp={() => toggleEnabled(entry)}");
	});

	test("restores keyboard focus after opening a provider model picker", () => {
		const source = readFileSync(
			join(import.meta.dir, "../../src/tui/components/priority-screen.tsx"),
			"utf8",
		);

		expect(source).toContain(
			"const restoreFocus = () => queueMicrotask(() => container?.focus?.())",
		);
		expect(source).toContain(
			"props.openModelPicker(entry.providerID, restoreFocus)",
		);
	});
});
