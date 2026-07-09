import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(path: string): string {
	return readFileSync(join(root, path), "utf8");
}

describe("release workflow", () => {
	test("package metadata exposes Changesets release scripts", () => {
		const packageJson = JSON.parse(read("package.json"));

		expect(packageJson.scripts.changeset).toBe("changeset");
		expect(packageJson.scripts.version).toContain("changeset version");
		expect(packageJson.scripts.release).toBe("changeset publish");
		expect(packageJson.devDependencies["@changesets/cli"]).toBeString();
	});

	test("Changesets is configured for this public npm package", () => {
		const config = JSON.parse(read(".changeset/config.json"));

		expect(config.access).toBe("public");
		expect(config.baseBranch).toBe("main");
		expect(config.updateInternalDependencies).toBe("patch");
	});

	test("workflow versions and publishes npm directly from main", () => {
		const workflow = read(".github/workflows/release.yml");

		expect(workflow).toContain("name: Release");
		expect(workflow).toContain("branches:");
		expect(workflow).toContain("- main");
		expect(workflow).toContain("contents: write");
		expect(workflow).toContain("id-token: write");
		expect(workflow).not.toContain("NODE_AUTH_TOKEN");
		expect(workflow).toContain("oven-sh/setup-bun@v2");
		expect(workflow).toContain("npm install --global npm@latest");
		expect(workflow).toContain("bun install --frozen-lockfile");
		expect(workflow).toContain("bun run version");
		expect(workflow).toContain("bun run release");
		expect(workflow).not.toContain("changesets/action@v1");
		expect(workflow).not.toContain("pull-requests: write");
		expect(workflow).toContain("NPM_CONFIG_PROVENANCE: true");
		expect(workflow).not.toContain("NPM_TOKEN");
		expect(workflow).toContain("bun run checktypes");
		expect(workflow).toContain("bun run test");
		expect(workflow).toContain("bun run build");
		expect(workflow).toContain("bun scripts/release/push-release-refs.ts");
		expect(workflow).toContain("bun scripts/release/create-github-release.ts");
		expect(workflow).not.toContain("node <<'NODE'");
	});

	test("workflow skips versioning when no changesets are pending", () => {
		const workflow = read(".github/workflows/release.yml");

		expect(workflow).toContain("id: release_changesets");
		expect(workflow).toContain("bun scripts/release/has-changesets.ts");
		expect(workflow).toContain(
			"if: steps.release_changesets.outputs.has_changesets == 'true'",
		);
	});

	test("workflow skips npm publish when package version already exists", () => {
		const workflow = read(".github/workflows/release.yml");

		expect(workflow).toContain("id: package_metadata");
		expect(workflow).toContain("bun scripts/release/package-metadata.ts");
		expect(workflow).toContain("id: npm_package");
		expect(workflow).toContain("bun scripts/release/check-npm-published.ts");
		expect(workflow).toContain(
			"if: steps.npm_package.outputs.is_published == 'false'",
		);
	});

	test("workflow can create a GitHub release from the changelog on rerun", () => {
		const workflow = read(".github/workflows/release.yml");

		expect(workflow).toContain("bun scripts/release/ensure-tag.ts");
		expect(workflow).toContain("bun scripts/release/write-release-notes.ts");
		expect(workflow).toContain("bun scripts/release/push-release-refs.ts");
		expect(workflow).toContain("bun scripts/release/create-github-release.ts");
		expect(workflow).toContain("GH_TOKEN: ${{ github.token }}");
	});
});
