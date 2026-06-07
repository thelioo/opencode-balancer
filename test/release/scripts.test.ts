import { afterEach, describe, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkNpmPublished } from "../../scripts/release/check-npm-published";
import { createGithubRelease } from "../../scripts/release/create-github-release";
import { ensureTag } from "../../scripts/release/ensure-tag";
import { hasChangesets } from "../../scripts/release/has-changesets";
import { writePackageMetadata } from "../../scripts/release/package-metadata";
import { pushReleaseRefs } from "../../scripts/release/push-release-refs";
import { writeReleaseNotes } from "../../scripts/release/write-release-notes";

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0))
		rmSync(dir, { force: true, recursive: true });
});

function tempDir() {
	const dir = mkdtempSync(join(tmpdir(), "release-scripts-"));
	tempDirs.push(dir);
	return dir;
}

function read(path: string) {
	return readFileSync(path, "utf8");
}

describe("release scripts", () => {
	test("detects pending changesets and ignores the README", async () => {
		const dir = tempDir();
		const changesetDir = join(dir, ".changeset");
		const outputPath = join(dir, "output");
		mkdirSync(changesetDir);
		writeFileSync(join(changesetDir, "README.md"), "docs");

		await hasChangesets({ changesetDir, outputPath });
		expect(read(outputPath)).toBe("has_changesets=false\n");

		writeFileSync(join(changesetDir, "release.md"), "---\n");
		await hasChangesets({ changesetDir, outputPath });
		expect(read(outputPath)).toBe(
			"has_changesets=false\nhas_changesets=true\n",
		);
	});

	test("writes package metadata outputs", async () => {
		const dir = tempDir();
		const packagePath = join(dir, "package.json");
		const outputPath = join(dir, "output");
		writeFileSync(
			packagePath,
			JSON.stringify({ name: "pkg", version: "1.2.3" }),
		);

		await writePackageMetadata({ outputPath, packagePath });

		expect(read(outputPath)).toBe("name=pkg\nversion=1.2.3\ntag=v1.2.3\n");
	});

	test("checks whether the npm package version is published", async () => {
		const dir = tempDir();
		const outputPath = join(dir, "output");
		const commands: string[][] = [];

		await checkNpmPublished({
			outputPath,
			packageName: "pkg",
			packageVersion: "1.2.3",
			run: async (command) => {
				commands.push(command);
				return 0;
			},
		});

		expect(commands).toEqual([["npm", "view", "pkg@1.2.3", "version"]]);
		expect(read(outputPath)).toBe("is_published=true\n");
	});

	test("marks npm package version as unpublished when npm view fails", async () => {
		const dir = tempDir();
		const outputPath = join(dir, "output");

		await checkNpmPublished({
			outputPath,
			packageName: "pkg",
			packageVersion: "1.2.3",
			run: async () => 1,
		});

		expect(read(outputPath)).toBe("is_published=false\n");
	});

	test("creates the release tag only when missing", async () => {
		const commands: string[][] = [];

		await ensureTag({
			releaseTag: "v1.2.3",
			run: async (command) => {
				commands.push(command);
				return command[0] === "git" && command[1] === "rev-parse" ? 1 : 0;
			},
		});

		expect(commands).toEqual([
			["git", "config", "user.name", "github-actions[bot]"],
			[
				"git",
				"config",
				"user.email",
				"41898282+github-actions[bot]@users.noreply.github.com",
			],
			["git", "rev-parse", "v1.2.3"],
			["git", "tag", "-a", "v1.2.3", "-m", "v1.2.3"],
		]);
	});

	test("writes release notes for the current changelog version", async () => {
		const dir = tempDir();
		const changelogPath = join(dir, "CHANGELOG.md");
		const outputPath = join(dir, "release-notes.md");
		writeFileSync(
			changelogPath,
			"# pkg\n\n## 1.2.3\n\n### Minor Changes\n\n- New thing\n\n## 1.2.2\n\n- Old thing\n",
		);

		await writeReleaseNotes({
			changelogPath,
			outputPath,
			packageVersion: "1.2.3",
		});

		expect(read(outputPath)).toBe("### Minor Changes\n\n- New thing\n");
	});

	test("creates a GitHub Release only when missing", async () => {
		const commands: string[][] = [];

		await createGithubRelease({
			notesFile: "release-notes.md",
			releaseTag: "v1.2.3",
			run: async (command) => {
				commands.push(command);
				return command[0] === "gh" &&
					command[1] === "release" &&
					command[2] === "view"
					? 1
					: 0;
			},
		});

		expect(commands).toEqual([
			["gh", "release", "view", "v1.2.3"],
			[
				"gh",
				"release",
				"create",
				"v1.2.3",
				"--title",
				"v1.2.3",
				"--notes-file",
				"release-notes.md",
			],
		]);
	});

	test("pushes main but skips the release tag when it already exists remotely", async () => {
		const commands: string[][] = [];

		await pushReleaseRefs({
			releaseTag: "v1.2.3",
			run: async (command) => {
				commands.push(command);
				return 0;
			},
		});

		expect(commands).toEqual([
			["git", "push", "origin", "HEAD:main"],
			[
				"git",
				"ls-remote",
				"--exit-code",
				"--tags",
				"origin",
				"refs/tags/v1.2.3",
			],
		]);
	});

	test("pushes the release tag when it does not exist remotely", async () => {
		const commands: string[][] = [];

		await pushReleaseRefs({
			releaseTag: "v1.2.3",
			run: async (command) => {
				commands.push(command);
				return command[1] === "ls-remote" ? 1 : 0;
			},
		});

		expect(commands).toEqual([
			["git", "push", "origin", "HEAD:main"],
			[
				"git",
				"ls-remote",
				"--exit-code",
				"--tags",
				"origin",
				"refs/tags/v1.2.3",
			],
			["git", "push", "origin", "refs/tags/v1.2.3"],
		]);
	});
});
