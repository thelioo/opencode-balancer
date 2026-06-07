import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";

const databases = new Map<string, Database>();

function isMissingFileError(error: unknown) {
    return (error as { code?: string }).code === "ENOENT";
}

function isClosedDatabaseError(error: unknown) {
    return error instanceof Error && /closed/i.test(error.message);
}

function cachedDatabaseIsOpen(database: Database) {
    try {
        database.exec("SELECT 1;");
        return true;
    } catch (error) {
        if (isClosedDatabaseError(error)) return false;
        throw error;
    }
}

export function secureDatabaseFiles(path: string) {
    for (const file of [path, `${path}-wal`, `${path}-shm`]) {
        try {
            chmodSync(file, 0o600);
        } catch (error) {
            if (!isMissingFileError(error)) throw error;
        }
    }
}

export function openBalancerDatabase(path: string) {
    const existing = databases.get(path);
    if (existing) {
        if (cachedDatabaseIsOpen(existing)) return existing;
        databases.delete(path);
    }

    mkdirSync(dirname(path), { recursive: true });
    const database = new Database(path);
    try {
        database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
        secureDatabaseFiles(path);
        databases.set(path, database);
        return database;
    } catch (error) {
        try {
            database.close();
        } catch {}
        throw error;
    }
}

export function closeBalancerDatabase(path: string) {
    const existing = databases.get(path);
    if (!existing) return;

    databases.delete(path);
    try {
        existing.close();
    } catch (error) {
        if (!isClosedDatabaseError(error)) throw error;
    }
}
