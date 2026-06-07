import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("PriorityScreen", () => {
    test("fills selected row background across model and enabled cells", () => {
        const source = readFileSync(join(import.meta.dir, "../../src/tui/components/priority-screen.tsx"), "utf8");

        expect(source).toContain('backgroundColor={rowProps.selected ? selectedColors().bg : undefined}');
        expect(source).toContain('backgroundColor={selected() ? selectedColors().bg : undefined}');
        expect(source).toContain('onMouseUp={() => props.openModelPicker(entry.providerID)}');
        expect(source).toContain('onMouseUp={() => toggleEnabled(entry)}');
    });
});
