import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openBalancerDatabase, closeBalancerDatabase } from "../../src/core/database";
import { appendEvent, listEvents } from "../../src/core/events";
import { migrate } from "../../src/core/schema";

let dirs: string[] = [];
let paths: string[] = [];

function db() {
    const dir = mkdtempSync(join(tmpdir(), "opencode-balancer-"));
    dirs.push(dir);
    const path = join(dir, "balancer.sqlite");
    paths.push(path);
    const database = openBalancerDatabase(path);
    migrate(database);
    return database;
}

afterEach(() => {
    for (const path of paths) closeBalancerDatabase(path);
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs = [];
    paths = [];
});

describe("events", () => {
    test("appends and lists newest events first", () => {
        const database = db();
        appendEvent(database, { type: "account_saved", providerID: "openai", alias: "main", message: "saved" });
        expect(listEvents(database, 10)[0]?.message).toBe("saved");
    });

    test("throws contextual error for corrupt metadata", () => {
        const database = db();
        const event = appendEvent(database, { type: "account_saved", message: "saved" });
        database.query("UPDATE events SET metadata_json = '' WHERE id = ?").run(event.id);

        expect(() => listEvents(database, 10)).toThrow(/Invalid event metadata JSON/);
    });
});
