import { existsSync } from "node:fs";

function joinPath(...parts: string[]) {
	return parts.filter(Boolean).join("/").replace(/\/+/g, "/");
}

function homeDir() {
	return (
		Bun.env.HOME ||
		Bun.env.USERPROFILE ||
		(Bun.env.HOMEDRIVE && Bun.env.HOMEPATH
			? `${Bun.env.HOMEDRIVE}${Bun.env.HOMEPATH}`
			: "/")
	);
}

// opencode resolves its directories with the xdg-basedir package, which
// applies the XDG defaults on every platform — including Windows, where it
// never consults LOCALAPPDATA. Mirror that so we read the same auth.json
// opencode writes.
function xdgConfigHome() {
	return Bun.env.XDG_CONFIG_HOME || joinPath(homeDir(), ".config");
}

function xdgDataHome() {
	return Bun.env.XDG_DATA_HOME || joinPath(homeDir(), ".local", "share");
}

export function configDir() {
	const configured = Bun.env.OPENCODE_CONFIG_DIR;
	return configured
		? joinPath(configured)
		: joinPath(xdgConfigHome(), "opencode");
}

export function dataDir() {
	return joinPath(xdgDataHome(), "opencode");
}

export function storePath() {
	const path = joinPath(configDir(), "balancer.sqlite");
	if (existsSync(path)) return path;
	// Older releases resolved the config dir to LOCALAPPDATA on Windows.
	// Keep using a store created there so existing accounts are not lost.
	const legacyRoot =
		!Bun.env.OPENCODE_CONFIG_DIR &&
		!Bun.env.XDG_CONFIG_HOME &&
		Bun.env.LOCALAPPDATA;
	if (legacyRoot) {
		const legacy = joinPath(legacyRoot, "opencode", "balancer.sqlite");
		if (existsSync(legacy)) return legacy;
	}
	return path;
}

export function nativeAuthPath() {
	return joinPath(dataDir(), "auth.json");
}
