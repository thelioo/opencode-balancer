import { existsSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

type PackageJson = {
	name?: string;
	version?: string;
};

export type CacheInvalidationInput = {
	cacheDir?: string;
	currentVersion: string;
	latestVersion: string;
	moduleUrl: string;
	packageName: string;
};

export type CacheInvalidationResult = {
	removed: string[];
	reason?: string;
};

export type CacheUpdateCheckInput = Omit<
	CacheInvalidationInput,
	"latestVersion"
> & {
	fetchLatestVersion?: () => Promise<string | undefined>;
};

function opencodeCacheDir() {
	if (process.env.XDG_CACHE_HOME)
		return join(process.env.XDG_CACHE_HOME, "opencode");
	if (process.platform === "darwin") {
		return join(homedir(), "Library", "Caches", "opencode");
	}
	if (process.platform === "win32") {
		return join(
			process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
			"opencode",
		);
	}
	return join(homedir(), ".cache", "opencode");
}

function readPackageJson(file: string): PackageJson | undefined {
	try {
		return JSON.parse(readFileSync(file, "utf8")) as PackageJson;
	} catch {
		return;
	}
}

function packagePathSegments(packageName: string) {
	return packageName.split("/").filter(Boolean);
}

function findInstalledPackageDir(file: string, packageName: string) {
	const segments = packagePathSegments(packageName);
	let current = file;
	while (current !== dirname(current)) {
		if (
			segments.every((segment, index) => {
				const parts = current.split(sep);
				return parts[parts.length - segments.length + index] === segment;
			})
		) {
			if (current.split(sep).at(-(segments.length + 1)) === "node_modules") {
				return current;
			}
		}
		current = dirname(current);
	}
}

function isPathInside(child: string, parent: string) {
	const normalizedParent = parent.endsWith(sep) ? parent : `${parent}${sep}`;
	return child === parent || child.startsWith(normalizedParent);
}

function isLatestSandbox(sandboxRoot: string, packageName: string) {
	return sandboxRoot.split(sep).join("/").endsWith(`${packageName}@latest`);
}

export function invalidateOutdatedPackageCache({
	cacheDir = opencodeCacheDir(),
	currentVersion,
	latestVersion,
	moduleUrl,
	packageName,
}: CacheInvalidationInput): CacheInvalidationResult {
	if (!currentVersion || !latestVersion || currentVersion === latestVersion) {
		return { reason: "up-to-date", removed: [] };
	}

	let moduleFile: string;
	try {
		moduleFile = moduleUrl.startsWith("file://")
			? fileURLToPath(moduleUrl)
			: moduleUrl;
	} catch {
		return { reason: "invalid-module-url", removed: [] };
	}

	const installedPackageDir = findInstalledPackageDir(moduleFile, packageName);
	if (!installedPackageDir)
		return { reason: "package-dir-not-found", removed: [] };

	const nodeModulesDir = dirname(dirname(installedPackageDir));
	if (nodeModulesDir.split(sep).at(-1) !== "node_modules") {
		return { reason: "node-modules-not-found", removed: [] };
	}

	const sandboxRoot = dirname(nodeModulesDir);
	const packagesDir = join(cacheDir, "packages");
	if (!isPathInside(sandboxRoot, packagesDir)) {
		return { reason: "outside-opencode-packages-cache", removed: [] };
	}
	if (!isLatestSandbox(sandboxRoot, packageName)) {
		return { reason: "not-latest-sandbox", removed: [] };
	}

	const packageJson = readPackageJson(
		join(installedPackageDir, "package.json"),
	);
	if (
		packageJson?.name !== packageName ||
		packageJson.version !== currentVersion
	) {
		return { reason: "version-mismatch", removed: [] };
	}

	if (!existsSync(sandboxRoot))
		return { reason: "sandbox-missing", removed: [] };
	rmSync(sandboxRoot, { force: true, recursive: true });
	return { removed: [sandboxRoot] };
}

export async function fetchNpmLatestVersion(packageName: string) {
	try {
		const response = await fetch(
			`https://registry.npmjs.org/-/package/${encodeURIComponent(packageName)}/dist-tags`,
			{ headers: { accept: "application/json" } },
		);
		if (!response.ok) return;
		const data = (await response.json()) as { latest?: unknown };
		return typeof data.latest === "string" ? data.latest : undefined;
	} catch {
		return;
	}
}

export async function checkAndInvalidateOutdatedPackageCache({
	fetchLatestVersion,
	...input
}: CacheUpdateCheckInput): Promise<CacheInvalidationResult> {
	const latestVersion = await (
		fetchLatestVersion ?? (() => fetchNpmLatestVersion(input.packageName))
	)();
	if (!latestVersion)
		return { reason: "latest-version-unavailable", removed: [] };

	return invalidateOutdatedPackageCache({
		...input,
		latestVersion,
	});
}
