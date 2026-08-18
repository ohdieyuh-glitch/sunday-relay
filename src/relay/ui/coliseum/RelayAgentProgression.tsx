import './relay-coliseum.css';

import { COLISEUM_FIXTURE_DISCLOSURE } from './fixtures';
import { chakraLabel } from '../../shared/relay-chakra';
import type { AgentProgressionView, DuelCommandView } from '../../mission';
import type { ColiseumDataSource } from './RelayColiseumConsole';

/**
 * THE AGENT'S EARNED PROGRESSION, RENDERED — nothing chosen, nothing invented.
 *
 * Every figure comes from `AgentProgressionView`, the pure projection of the
 * append-only Coliseum XP ledger (`deriveAgentProgression`). This component
 * derives nothing itself:
 *
 * - `xpToNextLevel === null` means MAX LEVEL, and it says so — it never
 *   invents a number for a level that does not exist;
 * - `earnedChakraTier === null` means NOTHING HAS BEEN EARNED, and the panel
 *   says the Dog keeps its gold rather than defaulting to root;
 * - an UNLOCKED command is permission to ask, never an engine: the panel
 *   composes each unlock with the duel view's binding state, so an
 *   unlocked-but-unbound command reads "unlocked, no engine yet". Without a
 *   duel view the binding is UNKNOWN on this surface, and it says that too.
 *
 * `source` is REQUIRED, like every Coliseum surface: fixture data cannot
 * render without its SIMULATED DATA banner, and the banner comes first.
 */
export interface RelayAgentProgressionProps {
  view: AgentProgressionView;
  /**
   * Command binding state from the duel view (`DuelResultsView.commands`).
   * Absent means this surface has no duel view to consult, and each unlocked
   * command truthfully reads "engine binding unknown" rather than guessing.
   */
  commands?: readonly DuelCommandView[];
  /** Where the view came from. Fixture data always shows its disclosure. */
  source: ColiseumDataSource;
}

function unlockedCommandVerdict(
  name: AgentProgressionView['unlockedCommands'][number],
  commands: readonly DuelCommandView[] | undefined,
): { verdict: string; binding: 'bound' | 'unbound' | 'unknown' } {
  if (commands === undefined) {
    return { verdict: 'unlocked · engine binding unknown on this surface', binding: 'unknown' };
  }
  const command = commands.find((c) => c.name === name);
  if (command === undefined) {
    // Absence from the list is not a binding fact — only 'unbound' is.
    return { verdict: 'unlocked · engine binding unknown on this surface', binding: 'unknown' };
  }
  if (command.binding === 'unbound') {
    return { verdict: 'unlocked, no engine yet', binding: 'unbound' };
  }
  return { verdict: 'unlocked · bound to an engine', binding: 'bound' };
}

export function RelayAgentProgression({ view, commands, source }: RelayAgentProgressionProps) {
  return (
    <section className="relay-coliseum-prog" aria-label="Agent progression">
      {source === 'development_fixture' ? (
        <p className="relay-coliseum-disclosure" role="note">
          SIMULATED DATA — {COLISEUM_FIXTURE_DISCLOSURE}
        </p>
      ) : null}
      <header className="relay-coliseum-prog-head">
        <h3 className="relay-coliseum-prog-title">AGENT PROGRESSION</h3>
        <span className="relay-coliseum-prog-agent">{view.agentId}</span>
      </header>

      <dl className="relay-coliseum-stats relay-coliseum-prog-stats">
        <dt>Level</dt>
        <dd data-testid="prog-level">{view.level}</dd>
        <dt>Total XP</dt>
        <dd data-testid="prog-total-xp">{view.totalXp}</dd>
        <dt>Toward next level</dt>
        <dd data-testid="prog-next-level">
          {view.xpToNextLevel === null
            ? 'Max level — there is no next level'
            : `${view.xpIntoLevel} XP into this level · ${view.xpToNextLevel} XP to next`}
        </dd>
        <dt>Earned chakra tier</dt>
        <dd data-testid="prog-earned-tier">
          {view.earnedChakraTier === null
            ? 'No tier earned yet — the Dog keeps its gold'
            : `${chakraLabel(view.earnedChakraTier)} — earned in the Coliseum`}
        </dd>
        <dt>Autonomous-run turn cap</dt>
        <dd data-testid="prog-turn-cap">{view.autonomousRunTurnCap}</dd>
        <dt>Evaluation depth</dt>
        <dd data-testid="prog-eval-depth">{view.evaluationDepth}</dd>
      </dl>

      <section className="relay-coliseum-prog-unlocks" aria-label="Unlocked commands">
        <h4 className="relay-coliseum-prog-unlocks-title">UNLOCKED COMMANDS</h4>
        <p className="relay-coliseum-prog-unlocks-note">
          An unlock is permission to ask, never an engine — unbound commands still refuse.
        </p>
        <ul className="relay-coliseum-prog-unlock-list">
          {view.unlockedCommands.map((name) => {
            const { verdict, binding } = unlockedCommandVerdict(name, commands);
            return (
              <li
                key={name}
                className="relay-coliseum-prog-unlock"
                data-binding={binding}
              >
                <span className="relay-coliseum-prog-unlock-name">{name}</span>
                <span className="relay-coliseum-prog-unlock-verdict">{verdict}</span>
              </li>
            );
          })}
        </ul>
      </section>
    </section>
  );
}
