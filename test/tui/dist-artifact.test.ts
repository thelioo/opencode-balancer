import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("built TUI artifact", () => {
	test("disables native model replay for the priority model picker", () => {
		const artifact = join(import.meta.dir, "../../dist/tui/tui.tsx");
		if (!existsSync(artifact)) return;

		const source = readFileSync(artifact, "utf8");
		const priorityRoute = source.slice(
			source.indexOf('name: "balancer.priority"'),
			source.indexOf("}),", source.indexOf('name: "balancer.priority"')),
		);

		expect(priorityRoute).toContain(
			"openProviderModelDialog(api, state, providerID",
		);
		expect(priorityRoute).toContain("applyNativeSelection: false");
	});
});
