function joinPath(...parts: string[]) {
	return parts.filter(Boolean).join("/").replace(/\/+/g, "/");
}

function homeDir() {
	return Bun.env.HOME || "/";
}

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
	return joinPath(configDir(), "balancer.sqlite");
}

export function nativeAuthPath() {
	return joinPath(dataDir(), "auth.json");
}
