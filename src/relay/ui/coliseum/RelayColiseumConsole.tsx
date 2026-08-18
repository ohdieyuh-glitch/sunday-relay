import './relay-coliseum.css';

import { useState } from 'react';

import { COLISEUM_FIXTURE_DISCLOSURE } from './fixtures';
import { RelayDuelResults } from './RelayDuelResults';
import {
  DUEL_MODE_LABEL,
  DUEL_STATUS_LABEL,
  parseDuelCommand,
  type DuelCommandName,
  type DuelResultsView,
} from './projections';

/**
 * THE DUEL COMMAND CONSOLE.
 *
 * A bottom-chat command line over one duel. It recognizes the nine duel
 * commands plus Ctrl+A for an Automation Fight — and it is honest about what
 * each keystroke can actually do:
 *
 * - a BOUND command is handed to `onCommand` and the console says it was
 *   dispatched, nothing more (the engine's answer arrives through the view);
 * - an UNBOUND command produces a "not yet wired to an engine" line and NO
 *   result of any kind — a fake result here would be a fabricated fact;
 * - Ctrl+A requests an Automation Fight through `onAutomationFight`, or says
 *   truthfully that no automation engine is attached.
 *
 * `source` is REQUIRED: the caller must state whether the view is live or a
 * development fixture, and a fixture source always renders the SIMULATED DATA
 * banner before any figure. There is no way to construct this console with
 * simulated data and no banner.
 */
export type ColiseumDataSource = 'development_fixture' | 'live';

export interface RelayColiseumConsoleProps {
  view: DuelResultsView;
  /** Where the view came from. Fixture data always shows its disclosure. */
  source: ColiseumDataSource;
  onCommand?: (name: DuelCommandName) => void;
  onAutomationFight?: () => void;
}

interface ConsoleLine {
  id: number;
  tone: 'dispatched' | 'unbound' | 'unknown';
  text: string;
}

export function RelayColiseumConsole(props: RelayColiseumConsoleProps) {
  const { view } = props;
  const [input, setInput] = useState('');
  const [lines, setLines] = useState<ConsoleLine[]>([]);

  const say = (tone: ConsoleLine['tone'], text: string) => {
    setLines((prior) => [...prior, { id: prior.length, tone, text }]);
  };

  const submit = () => {
    const raw = input.trim();
    if (raw === '') return;
    setInput('');
    const name = parseDuelCommand(raw);
    if (name === null) {
      say('unknown', `"${raw}" is not a duel command. Nothing was dispatched.`);
      return;
    }
    const command = view.commands.find((c) => c.name === name);
    if (command === undefined || command.binding === 'unbound') {
      say('unbound', `${name} is not yet wired to an engine — no result was produced.`);
      return;
    }
    if (props.onCommand === undefined) {
      say('unbound', `${name} is bound, but this surface has no dispatch port — nothing was sent.`);
      return;
    }
    props.onCommand(name);
    say('dispatched', `${name} dispatched. Results will appear when the engine reports.`);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.ctrlKey && (event.key === 'a' || event.key === 'A')) {
      event.preventDefault();
      if (props.onAutomationFight === undefined) {
        say('unbound', 'Automation Fight is not yet wired to an engine — no fight was started.');
        return;
      }
      props.onAutomationFight();
      say('dispatched', 'Automation Fight requested.');
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  };

  return (
    <section className="relay-coliseum-console" aria-label="Duel command console">
      {props.source === 'development_fixture' ? (
        <p className="relay-coliseum-disclosure" role="note">
          SIMULATED DATA — {COLISEUM_FIXTURE_DISCLOSURE}
        </p>
      ) : null}
      <header className="relay-coliseum-console-head">
        <h2 className="relay-coliseum-console-title">WONDERLAND COLISEUM</h2>
        <span className="relay-coliseum-console-status" data-status={view.status}>
          {DUEL_STATUS_LABEL[view.status]} · {DUEL_MODE_LABEL[view.mode]}
        </span>
      </header>

      <p className="relay-coliseum-console-versus">
        {view.participants[0].displayName}
        <span className="relay-coliseum-console-vs"> vs </span>
        {view.participants[1].displayName}
      </p>

      <ul className="relay-coliseum-commands" aria-label="Duel commands">
        {view.commands.map((command) => (
          <li
            key={command.name}
            className="relay-coliseum-command"
            data-binding={command.binding}
          >
            <span className="relay-coliseum-command-name">{command.name}</span>
            <span className="relay-coliseum-command-desc">{command.description}</span>
            <span className="relay-coliseum-command-binding">
              {command.binding === 'bound' ? 'bound' : 'not yet wired to an engine'}
            </span>
          </li>
        ))}
      </ul>

      <RelayDuelResults view={view} source={props.source} />

      {lines.length > 0 ? (
        <ul className="relay-coliseum-log" aria-label="Console log" role="log">
          {lines.map((line) => (
            <li key={line.id} className="relay-coliseum-log-line" data-tone={line.tone}>
              {line.text}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="relay-coliseum-inputline">
        <input
          className="relay-coliseum-input"
          type="text"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="TRACE · SB · RED · VERIFY · FORK · GUARD · ROLLBACK · DEEP · SWARM — Ctrl+A for Automation Fight"
          aria-label="Duel command input"
        />
        <button type="button" className="relay-coliseum-send" onClick={submit}>
          Send
        </button>
      </div>
    </section>
  );
}
