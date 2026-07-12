import { afterEach, describe, expect, test } from "bun:test";
import { configDir, dataDir } from "../../src/core/path";

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

	test("uses Windows config and data env vars when XDG and HOME are unavailable", () => {
		delete Bun.env.OPENCODE_CONFIG_DIR;
		delete Bun.env.XDG_CONFIG_HOME;
		delete Bun.env.XDG_DATA_HOME;
		delete Bun.env.HOME;
		Bun.env.LOCALAPPDATA = String.raw`C:\Users\me\AppData\Local`;
		Bun.env.USERPROFILE = String.raw`C:\Users\me`;

		expect(configDir()).toBe(String.raw`C:\Users\me\AppData\Local/opencode`);
		expect(dataDir()).toBe(String.raw`C:\Users\me\AppData\Local/opencode`);
	});
});
