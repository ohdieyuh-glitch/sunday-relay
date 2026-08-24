import type { WonderlandState } from './types';
import type { WonderlandStore } from './store';

/**
 * Production database boundary. Implementations MUST lock the singleton row,
 * run the callback in one serializable transaction, and commit state plus its
 * appended outbox events atomically. Relay currently ships no database SDK;
 * hosts inject their PostgreSQL/SQLite implementation here instead of falling
 * back to process memory.
 */
export interface TransactionalWonderlandDatabase {
  readState(): WonderlandState;
  transaction<T>(operation: (state: WonderlandState) => T): T;
}

export function createDatabaseWonderlandStore(database: TransactionalWonderlandDatabase): WonderlandStore {
  return {
    read: () => structuredClone(database.readState()),
    transact: (mutation) => database.transaction((current) => mutation(structuredClone(current))),
  };
}
