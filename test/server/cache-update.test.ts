import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
	checkAndInvalidateOutdatedPackageCache,
	invalidateOutdatedPackageCache,
} from "../../src/server/cache-update";

const PACKAGE_NAME = "@thelioo/opencode-balancer";

function writePackageJson(file: string, data: Record<string, unknown>) {
	mkdirSync(join(file, ".."), { recursive: true });
	writeFileSync(file, JSON.stringify(data, null, 2));
}

function createCachedPackage(cacheDir: string, spec: string, version: string) {
	const root = join(cacheDir, "packages", spec);
	const packageDir = join(
		root,
		"node_modules",
		"@thelioo",
		"opencode-balancer",
	);
	writePackageJson(join(root, "package.json"), {
		dependencies: { [PACKAGE_NAME]: version },
	});
	writePackageJson(join(packageDir, "package.json"), {
		name: PACKAGE_NAME,
		version,
	});
	mkdirSync(join(packageDir, "dist"), { recursive: true });
	writeFileSync(join(packageDir, "dist", "index.js"), "export default {};\n");
	return { packageDir, root };
}

describe("cache update invalidation", () => {
	test("removes only the active latest sandbox for the exact outdated version", () => {
		const dir = join(
			tmpdir(),
			`opencode-balancer-cache-${crypto.randomUUID()}`,
		);
		try {
			const latest = createCachedPackage(
				dir,
				"@thelioo/opencode-balancer@latest",
				"0.2.2",
			);
			const pinned = createCachedPackage(
				dir,
				"@thelioo/opencode-balancer@0.1.6",
				"0.1.6",
			);

			const result = invalidateOutdatedPackageCache({
				cacheDir: dir,
				currentVersion: "0.2.2",
				latestVersion: "0.2.3",
				moduleUrl: pathToFileURL(join(latest.packageDir, "dist", "index.js"))
					.href,
				packageName: PACKAGE_NAME,
			});

			expect(result.removed).toEqual([latest.root]);
			expect(existsSync(latest.root)).toBe(false);
			expect(existsSync(pinned.root)).toBe(true);
		} finally {
			rmSync(dir, { force: true, recursive: true });
		}
	});

	test("does not remove pinned sandboxes even when their package version is outdated", () => {
		const dir = join(
			tmpdir(),
			`opencode-balancer-cache-${crypto.randomUUID()}`,
		);
		try {
			const pinned = createCachedPackage(
				dir,
				"@thelioo/opencode-balancer@0.2.2",
				"0.2.2",
			);

			const result = invalidateOutdatedPackageCache({
				cacheDir: dir,
				currentVersion: "0.2.2",
				latestVersion: "0.2.3",
				moduleUrl: pathToFileURL(join(pinned.packageDir, "dist", "index.js"))
					.href,
				packageName: PACKAGE_NAME,
			});

			expect(result.removed).toEqual([]);
			expect(existsSync(pinned.root)).toBe(true);
		} finally {
			rmSync(dir, { force: true, recursive: true });
		}
	});

	test("does not remove a latest sandbox whose installed package version does not match the loaded version", () => {
		const dir = join(
			tmpdir(),
			`opencode-balancer-cache-${crypto.randomUUID()}`,
		);
		try {
			const latest = createCachedPackage(
				dir,
				"@thelioo/opencode-balancer@latest",
				"0.2.1",
			);

			const result = invalidateOutdatedPackageCache({
				cacheDir: dir,
				currentVersion: "0.2.2",
				latestVersion: "0.2.3",
				moduleUrl: pathToFileURL(join(latest.packageDir, "dist", "index.js"))
					.href,
				packageName: PACKAGE_NAME,
			});

			expect(result.removed).toEqual([]);
			expect(existsSync(latest.root)).toBe(true);
		} finally {
			rmSync(dir, { force: true, recursive: true });
		}
	});

	test("checks latest version, invalidates the exact cache, and notifies for restart", async () => {
		const dir = join(
			tmpdir(),
			`opencode-balancer-cache-${crypto.randomUUID()}`,
		);
		try {
			const latest = createCachedPackage(
				dir,
				"@thelioo/opencode-balancer@latest",
				"0.2.2",
			);
			const toasts: string[] = [];

			const result = await checkAndInvalidateOutdatedPackageCache({
				cacheDir: dir,
				currentVersion: "0.2.2",
				fetchLatestVersion: async () => "0.2.3",
				moduleUrl: pathToFileURL(join(latest.packageDir, "dist", "index.js"))
					.href,
				notify: async (message) => toasts.push(message),
				packageName: PACKAGE_NAME,
			});

			expect(result.removed).toEqual([latest.root]);
			expect(existsSync(latest.root)).toBe(false);
			expect(toasts).toEqual([
				"opencode-balancer v0.2.3 is ready. Restart opencode to update from v0.2.2.",
			]);
		} finally {
			rmSync(dir, { force: true, recursive: true });
		}
	});

	test("does not invalidate cache when the latest version check fails", async () => {
		const dir = join(
			tmpdir(),
			`opencode-balancer-cache-${crypto.randomUUID()}`,
		);
		try {
			const latest = createCachedPackage(
				dir,
				"@thelioo/opencode-balancer@latest",
				"0.2.2",
			);
			const toasts: string[] = [];

			const result = await checkAndInvalidateOutdatedPackageCache({
				cacheDir: dir,
				currentVersion: "0.2.2",
				fetchLatestVersion: async () => undefined,
				moduleUrl: pathToFileURL(join(latest.packageDir, "dist", "index.js"))
					.href,
				notify: async (message) => toasts.push(message),
				packageName: PACKAGE_NAME,
			});

			expect(result.removed).toEqual([]);
			expect(result.reason).toBe("latest-version-unavailable");
			expect(existsSync(latest.root)).toBe(true);
			expect(toasts).toEqual([]);
		} finally {
			rmSync(dir, { force: true, recursive: true });
		}
	});
});
