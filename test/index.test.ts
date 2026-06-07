import { describe, expect, test } from "bun:test";

import plugin from "../src/index";

describe("plugin entrypoint", () => {
    test("exports a root module that works for server and TUI loaders", () => {
        expect(typeof plugin).toBe("function");
        expect(plugin.id).toBe("opencode-balancer");
        expect(typeof plugin.tui).toBe("function");
    });
});
