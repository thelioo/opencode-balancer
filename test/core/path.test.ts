import { afterEach, describe, expect, test } from "bun:test";
import { configDir } from "../../src/core/path";

const originalConfigDir = Bun.env.OPENCODE_CONFIG_DIR;

afterEach(() => {
	if (originalConfigDir === undefined) {
		delete Bun.env.OPENCODE_CONFIG_DIR;
	} else {
		Bun.env.OPENCODE_CONFIG_DIR = originalConfigDir;
	}
});

describe("path helpers", () => {
	test("collapses repeated slashes in configured config dir", () => {
		Bun.env.OPENCODE_CONFIG_DIR = "/tmp//opencode///config";

		expect(configDir()).toBe("/tmp/opencode/config");
	});
});
