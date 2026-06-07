import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function readJson(path: string) {
	return JSON.parse(readFileSync(join(root, path), "utf8"));
}

describe("TypeScript configuration", () => {
	test("root config type-checks every project TypeScript file", () => {
		const config = readJson("tsconfig.json");

		expect(config.compilerOptions.noEmit).toBe(true);
		expect(config.compilerOptions.rootDir).toBeUndefined();
		expect(config.compilerOptions.outDir).toBeUndefined();
		expect(config.exclude).toEqual(["node_modules", "dist"]);
		expect(config.include).toEqual(["./**/*.ts", "./**/*.tsx"]);
	});

	test("build config is restricted to source files", () => {
		const config = readJson("tsconfig.build.json");

		expect(config.extends).toBe("./tsconfig.json");
		expect(config.compilerOptions.rootDir).toBe("src");
		expect(config.compilerOptions.outDir).toBe("dist");
		expect(config.compilerOptions.noEmit).toBe(false);
		expect(config.include).toEqual(["src"]);
	});

	test("build command runs the Bun build script", () => {
		const packageJson = readJson("package.json");

		expect(packageJson.scripts.build).toBe("bun scripts/build.ts");
	});
});
