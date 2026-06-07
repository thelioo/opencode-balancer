import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("TUI artifacts", () => {
	test("disables native model replay for the priority model picker", () => {
		const artifact = join(import.meta.dir, "../../src/tui/tui.tsx");
		const source = readFileSync(artifact, "utf8");
		const priorityRoute = source.slice(
			source.indexOf('name: "balancer.priority"'),
			source.indexOf("}),", source.indexOf('name: "balancer.priority"')),
		);

		expect(priorityRoute).toContain("openProviderModelDialog");
		expect(priorityRoute).toContain("providerID");
		expect(priorityRoute).toContain("applyNativeSelection: false");
	});

	test("uses copied TUI source for the built TUI export", () => {
		const distDir = join(import.meta.dir, "../../dist");
		if (!existsSync(distDir)) return;

		const artifact = join(import.meta.dir, "../../dist/tui/tui.tsx");
		const coreDependency = join(import.meta.dir, "../../dist/core/accounts.ts");
		const serverDependency = join(
			import.meta.dir,
			"../../dist/server/auth-watcher.ts",
		);
		expect(existsSync(artifact)).toBe(true);
		expect(existsSync(coreDependency)).toBe(true);
		expect(existsSync(serverDependency)).toBe(true);
	});

	test("uses OpenCode plugin module shapes for built entries", async () => {
		const distDir = join(import.meta.dir, "../../dist");
		if (!existsSync(distDir)) return;

		const serverModule = (await import("../../dist/index.js" as string)) as {
			default: Record<string, unknown>;
		};
		const tuiModule = (await import("../../dist/tui/tui.tsx" as string)) as {
			default: Record<string, unknown>;
		};

		expect(typeof serverModule.default).toBe("function");
		expect(serverModule.default.id).toBe("opencode-balancer");
		expect(typeof serverModule.default.tui).toBe("function");
		expect(typeof tuiModule.default).toBe("object");
		expect(typeof tuiModule.default.tui).toBe("function");
		expect("server" in tuiModule.default).toBe(false);
	});

	test("strips embedded source content from generated source maps", async () => {
		const sourceMap = join(import.meta.dir, "../../dist/index.js.map");
		if (!existsSync(sourceMap)) return;

		const map = await Bun.file(sourceMap).json();
		expect(map).not.toHaveProperty("sourcesContent");
	});
});
