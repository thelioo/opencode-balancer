// The balancer's server process and TUI process each hold their own SQLite
// connection to the same database file. With a short busy_timeout (see
// core/database.ts) a lock collision between them now fails fast instead of
// blocking the event loop for seconds — but that means periodic poll
// callbacks can occasionally throw a transient "database is locked" error.
// Since these polls run on setInterval with no caller to catch a throw, an
// uncaught error here would crash the TUI process rather than just skipping
// a refresh. Wrap every poll body in this so a transient failure just keeps
// the previously rendered state until the next tick succeeds.
export function safePoll(fn: () => void) {
	try {
		fn();
	} catch {
		// Transient lock contention or a closed/mid-migration database. The
		// next tick will retry; nothing to show the user for a single missed
		// refresh.
	}
}
