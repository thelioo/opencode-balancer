import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import {
	configDir,
	dataDir,
	nativeAuthPath,
	storePath,
} from "../../src/core/path";

const originalConfigDir = Bun.env.OPENCODE_CONFIG_DIR;
const originalDataHome = Bun.env.XDG_DATA_HOME;
const originalHome = Bun.env.HOME;
const originalLocalAppData = Bun.env.LOCALAPPDATA;
const originalUserProfile = Bun.env.USERPROFILE;
const originalXdgConfigHome = Bun.env.XDG_CONFIG_HOME;

afterEach(() => {
	if (originalConfigDir === undefined) {
		delete Bun.env.OPENCODE_CONFIG_DIR;
	} else {
		Bun.env.OPENCODE_CONFIG_DIR = originalConfigDir;
	}
	if (originalDataHome === undefined) delete Bun.env.XDG_DATA_HOME;
	else Bun.env.XDG_DATA_HOME = originalDataHome;
	if (originalHome === undefined) delete Bun.env.HOME;
	else Bun.env.HOME = originalHome;
	if (originalLocalAppData === undefined) delete Bun.env.LOCALAPPDATA;
	else Bun.env.LOCALAPPDATA = originalLocalAppData;
	if (originalUserProfile === undefined) delete Bun.env.USERPROFILE;
	else Bun.env.USERPROFILE = originalUserProfile;
	if (originalXdgConfigHome === undefined) delete Bun.env.XDG_CONFIG_HOME;
	else Bun.env.XDG_CONFIG_HOME = originalXdgConfigHome;
});

describe("path helpers", () => {
	test("collapses repeated slashes in configured config dir", () => {
		Bun.env.OPENCODE_CONFIG_DIR = "/tmp//opencode///config";

		expect(configDir()).toBe("/tmp/opencode/config");
	});

	test("matches opencode's xdg-basedir paths on Windows", () => {
		// opencode resolves its dirs with the xdg-basedir package, which uses
		// `~/.local/share` and `~/.config` on every platform — including
		// Windows, where it never consults LOCALAPPDATA. The balancer must
		// read auth.json from the same place opencode writes it (issue #36).
		delete Bun.env.OPENCODE_CONFIG_DIR;
		delete Bun.env.XDG_CONFIG_HOME;
		delete Bun.env.XDG_DATA_HOME;
		delete Bun.env.HOME;
		Bun.env.LOCALAPPDATA = String.raw`C:\Users\me\AppData\Local`;
		Bun.env.USERPROFILE = String.raw`C:\Users\me`;

		expect(configDir()).toBe(String.raw`C:\Users\me/.config/opencode`);
		expect(dataDir()).toBe(String.raw`C:\Users\me/.local/share/opencode`);
		expect(nativeAuthPath()).toBe(
			String.raw`C:\Users\me/.local/share/opencode/auth.json`,
		);
	});

	test("keeps using a legacy LOCALAPPDATA store when one already exists", () => {
		const root = `${import.meta.dir}/.tmp-path-test`;
		rmSync(root, { force: true, recursive: true });
		mkdirSync(`${root}/legacy/opencode`, { recursive: true });
		writeFileSync(`${root}/legacy/opencode/balancer.sqlite`, "");
		try {
			delete Bun.env.OPENCODE_CONFIG_DIR;
			delete Bun.env.XDG_CONFIG_HOME;
			delete Bun.env.XDG_DATA_HOME;
			delete Bun.env.HOME;
			Bun.env.LOCALAPPDATA = `${root}/legacy`;
			Bun.env.USERPROFILE = `${root}/home`;

			expect(storePath()).toBe(`${root}/legacy/opencode/balancer.sqlite`);

			rmSync(`${root}/legacy/opencode/balancer.sqlite`);
			expect(storePath()).toBe(`${root}/home/.config/opencode/balancer.sqlite`);
		} finally {
			rmSync(root, { force: true, recursive: true });
		}
	});
});
