import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(path: string): string {
	return readFileSync(join(root, path), "utf8");
}

describe("installation docs", () => {
	test("recommend unversioned package entry instead of @latest", () => {
		const installGuide = read("INSTALL.txt");
		const readme = read("README.md");

		expect(installGuide).toContain(
			"@thelioo/opencode-balancer (without @latest)",
		);
		expect(installGuide).not.toContain("@thelioo/opencode-balancer@latest");
		expect(readme).toContain(
			"Use the package name without an explicit `@latest` tag",
		);
		expect(readme).not.toContain(
			'"plugin": ["@thelioo/opencode-balancer@latest"]',
		);
	});
});
