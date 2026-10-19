export { RelayUsageBar } from './RelayUsageBar';
export { RelayUsageDetailPanel } from './RelayUsageDetailPanel';

import type { RelayUsageBarView } from '../../usage';

/**
 * The optional usage surface a host application passes into screens that
 * show the Usage Bar. Purely presentational: a projected view plus an
 * open-the-detail-panel intent. Callers that do not pass it render exactly
 * as before.
 */
export interface RelayWorkspaceUsage {
  readonly bar: RelayUsageBarView;
  readonly onOpenUsage: () => void;
}
