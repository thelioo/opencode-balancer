import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(path: string): string {
	return readFileSync(join(root, path), "utf8");
}

describe("installation docs", () => {
	test("install the local checkout via file:// URL", () => {
		const installGuide = read("INSTALL.txt");

		expect(installGuide).toContain("local checkout");
		expect(installGuide).toContain("file://<absolute-path-to-local-checkout>");
		expect(installGuide).not.toContain(
			"@secondstrikerss/opencode-balancer@latest",
		);
		expect(installGuide).not.toContain("without @latest");
		expect(installGuide).toMatch(/Do NOT run npm install/);
		expect(installGuide).toMatch(/Do NOT add the npm package name/);
		expect(installGuide).toContain("bun run build");
	});

	test("README does not pin @latest", () => {
		const readme = read("README.md");

		expect(readme).not.toContain(
			'"plugin": ["@thelioo/opencode-balancer@latest"]',
		);
	});
});
