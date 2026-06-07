import type { Database } from "bun:sqlite";
import { now } from "./time";
import type { BalancerEvent, BalancerEventType } from "./types";

type EventRow = {
	id: string;
	type: BalancerEventType;
	provider_id: string | null;
	alias: string | null;
	message: string;
	created_at: number;
	metadata_json: string;
};

export function appendEvent(
	db: Database,
	input: {
		type: BalancerEventType;
		providerID?: string;
		alias?: string;
		message: string;
		metadata?: Record<string, string>;
	},
) {
	const event: BalancerEvent = {
		alias: input.alias,
		createdAt: now(),
		id: crypto.randomUUID(),
		message: input.message,
		metadata: input.metadata ?? {},
		providerID: input.providerID,
		type: input.type,
	};
	db.query(
		`INSERT INTO events (id, type, provider_id, alias, message, created_at, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
	).run(
		event.id,
		event.type,
		event.providerID ?? null,
		event.alias ?? null,
		event.message,
		event.createdAt,
		JSON.stringify(event.metadata),
	);
	return event;
}

export function listEvents(db: Database, limit = 50) {
	return db
		.query<EventRow, [number]>(
			"SELECT * FROM events ORDER BY created_at DESC LIMIT ?",
		)
		.all(limit)
		.map((row) => {
			let metadata: Record<string, string>;
			try {
				metadata = JSON.parse(row.metadata_json) as Record<string, string>;
			} catch (error) {
				throw new Error(`Invalid event metadata JSON for event ${row.id}`, {
					cause: error,
				});
			}

			return {
				alias: row.alias ?? undefined,
				createdAt: row.created_at,
				id: row.id,
				message: row.message,
				metadata,
				providerID: row.provider_id ?? undefined,
				type: row.type,
			};
		});
}
