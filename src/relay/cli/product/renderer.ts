import type {
  CliCaps, EvidenceVM, FindingVM, HomeVM, ManualTaskVM, MissionConsoleVM, PanelVM,
  ProjectHomeVM, RecoveryVM, RepairVM, SafeEventVM, WorkforceVM,
} from './contracts';
import { DEMO_LABELS, PRODUCT_TAGLINE, ROLE_LABEL, ROLE_SHORT, ROLE_TONE } from './contracts';
import { GLYPHS, paint, symbolText } from './theme';
import { asciiFold, breakpoint, divider, fitLines, padVisible, spread, truncateVisible, visibleLength } from './layout';
import { footerDog, headerLogo } from './dog';
import { safePath, safeSummary } from './safety';

/**
 * Relay CLI renderers (Prompt 8.6) — PURE: (safe view model, caps, tick) →
 * lines. Recreates the founder-approved mockups: the pixel-dog header with
 * the SUNDAY RELAY wordmark and RLY route badge, the gold timeline STREAM
 * view (mockup 1), the bordered PANELS mission console (mockup 2), the
 * command bar, and the HANDOFF NETWORK footer with the walking Relay Dog.
 * A `[>_]` toggle badge in the header corner switches the two views.
 * Renderers never receive raw provider strings — only safe view models.
 */

const CONTENT_MAX = 110;

function contentWidth(caps: CliCaps): number {
  return Math.min(CONTENT_MAX, caps.width - 2);
}

/* ------------------------------ header ------------------------------- */

export function renderHeader(input: {
  caps: CliCaps;
  route: string;
  workforce: WorkforceVM | null;
  view?: 'stream' | 'panels';
  demo: boolean;
  subtitle?: string;
}): string[] {
  const { caps } = input;
  const p = paint(caps);
  const width = contentWidth(caps);
  const bp = breakpoint(caps.width);
  const lines: string[] = [];
  const toggle = input.view
    ? p.tone('gold', `[>_] VIEW / ${input.view.toUpperCase()}`) + p.dim('  V toggles')
    : p.tone('gold', '[>_] RELAY CLI');

  if (bp !== 'linear') {
    const logo = headerLogo(caps);
    // SUNDAY in cream, RELAY in muted gold, gray tagline — cream/gray carry the
    // hierarchy; gold is only the RELAY wordmark accent.
    const word = [
      p.boldTone('cream', 'S U N D A Y'),
      p.boldTone('gold', 'R E L A Y'),
      p.dim(PRODUCT_TAGLINE),
    ];
    const badge = p.tone('gold', `[ ${input.route} ]`);
    // The logo column is as wide as the widest dog row (+2), so the taller
    // four-legged dog can grow without colliding with the wordmark.
    const logoW = logo.reduce((m, l) => Math.max(m, visibleLength(l)), 0);
    // Logo left, wordmark beside it, toggle badge in the top-right corner. The
    // wordmark sits on the dog's upper rows so the head lines up with SUNDAY.
    const rows = Math.max(logo.length, word.length);
    for (let i = 0; i < rows; i += 1) {
      const left = `${padVisible(logo[i] ?? '', logoW + 2)}${word[i] ?? ''}`;
      const right = i === 0 ? toggle : i === 1 ? badge : '';
      lines.push(spread(left, right, width));
    }
  } else {
    lines.push(spread(p.boldTone('gold', 'SUNDAY RELAY'), toggle, width));
    lines.push(p.tone('gold', `[ ${input.route} ]`));
  }

  if (input.subtitle) lines.push(p.dim(input.subtitle));
  if (input.workforce) lines.push(...renderWorkforceStrip(input.workforce, caps));
  if (input.demo) {
    lines.push(p.tone('amber', DEMO_LABELS.join(' · ')));
  }
  lines.push(divider(caps, width));
  return lines;
}

export function renderWorkforceStrip(workforce: WorkforceVM, caps: CliCaps): string[] {
  const p = paint(caps);
  const dot = (online: boolean): string =>
    p.tone(online ? 'green' : 'gray', GLYPHS.dotOn(caps)) + ' ';
  const cells = [
    `${p.dim('ARCHITECT')}  ${dot(workforce.architect.online)}${p.tone('cream', workforce.architect.name)}`,
    `${p.dim('CODING AGENT')}  ${dot(workforce.coding.online)}${p.tone('cream', workforce.coding.name)}`,
    workforce.reviewer.configured
      ? `${p.dim('REVIEWER')}  ${dot(workforce.reviewer.online)}${p.tone('cyan', workforce.reviewer.name)}`
      : `${p.dim('REVIEWER')}  ${p.tone('gray', 'NOT CONFIGURED')}`,
    `${p.dim('MODE')}  ${p.boldTone('gold', workforce.mode)}`,
  ];
  if (breakpoint(caps.width) === 'full') {
    return [cells.join(p.dim(`  ${GLYPHS.vline(caps)}  `))];
  }
  return cells.map((c) => `  ${c}`);
}

/* --------------------------- stream view ------------------------------ */

export function renderStream(events: SafeEventVM[], caps: CliCaps, activeIndex = -1): string[] {
  const p = paint(caps);
  const width = contentWidth(caps);
  const bp = breakpoint(caps.width);
  const lines: string[] = [];
  const roleWidth = bp === 'full' ? 14 : 11;
  const textIndent = bp === 'linear' ? 2 : 4 + 10 + roleWidth + 2;

  events.forEach((event, index) => {
    const sym = symbolText(event.symbol, caps);
    const symbol = p.tone(event.tone ?? sym.tone, padVisible(sym.text, 2));
    const time = p.dim(event.at.padEnd(9));
    const role = p.tone(ROLE_TONE[event.role], padVisible(
      (bp === 'full' ? ROLE_SHORT[event.role] : ROLE_SHORT[event.role].slice(0, roleWidth)), roleWidth));
    const primary = p.tone(event.tone ?? 'cream', event.primary);
    // The most-recently-revealed event is the currently ACTIVE one — mark it
    // with a gold pointer so the founder's eye lands on live activity.
    const active = index === activeIndex;

    if (bp === 'linear') {
      const mark = active ? (caps.unicode ? '▸ ' : '> ') : '';
      lines.push(`${mark}${sym.text} ${event.at} ${ROLE_SHORT[event.role]}`);
      lines.push(`  ${event.primary}`);
      if (event.secondary) lines.push(`  ${event.secondary}`);
      if (event.annotation) lines.push(`  ${event.annotation.kind} ${event.annotation.text}`);
      return;
    }

    const lead = active ? p.tone('gold', caps.unicode ? '▸' : '>') : ' ';
    let first = `${lead}${symbol} ${time}${role}${primary}`;
    if (event.annotation && bp === 'full') {
      const annotation = renderAnnotation(event.annotation, caps);
      first = spread(first, annotation, width);
    }
    lines.push(visibleLength(first) > width ? truncateVisible(first, width, caps) : first);
    if (event.secondary) {
      lines.push(`${' '.repeat(Math.min(textIndent, 14))}${p.dim(event.secondary)}`);
    }
    if (event.annotation && bp !== 'full') {
      lines.push(`${' '.repeat(Math.min(textIndent, 14))}${renderAnnotation(event.annotation, caps)}`);
    }
    if (index < events.length - 1) {
      lines.push(` ${p.dim(GLYPHS.vline(caps))}`);
    }
  });
  return lines;
}

function renderAnnotation(annotation: NonNullable<SafeEventVM['annotation']>, caps: CliCaps): string {
  const p = paint(caps);
  const check = caps.unicode ? '✓ ' : 'OK ';
  switch (annotation.kind) {
    case 'COMPLETE': return p.tone('green', `${check}${annotation.text}`);
    case 'HELD': return p.tone('amber', annotation.text);
    case 'CREATE':
    case 'MODIFY':
    case 'RUN':
      return `${p.tone('gold', annotation.kind)} ${p.dim(safePath(annotation.text, 40))}`;
    case 'CONTEXT': return p.tone('gold', `CONTEXT ID: ${annotation.text}`);
    default: return p.dim(annotation.text);
  }
}

/* --------------------------- panels view ------------------------------ */

function statusDots(status: string, tone: string, tick: number, caps: CliCaps, active: boolean): string {
  const p = paint(caps);
  if (!caps.unicode) return p.tone(tone as never, status);
  const count = active && !caps.reducedMotion ? (tick % 3) + 1 : 2;
  const dots = active ? ` ${'●'.repeat(count)}` : '';
  return p.tone(tone as never, `${status}${dots}`);
}

export function renderPanel(panel: PanelVM, caps: CliCaps, tick: number): string[] {
  const p = paint(caps);
  const width = contentWidth(caps);
  const inner = width - 4;
  const h = GLYPHS.hline(caps);
  const v = p.tone('goldDim', GLYPHS.vline(caps));
  const active = panel.badge === 'ACTIVE' || panel.badge === 'LIVE' || panel.badge === 'REVIEWING' || panel.badge === 'VERIFYING';
  const titleLeft = `${p.tone('gold', GLYPHS.square(caps))} ${p.boldTone(panel.role === 'reviewer' ? 'cyan' : 'gold', panel.title)} ${p.dim(`[${panel.badge}]`)}`;
  const right = statusDots(panel.statusRight, panel.statusTone, tick, caps, active);
  // The title sits between `┌─ ` (3 cols) and ` …┐`, so it spans width-5, NOT
  // the body's inner (width-4) — otherwise the top border runs one column wide.
  const top = spread(titleLeft, right, width - 5);

  const body: string[] = [];
  for (const event of panel.events) {
    const sym = symbolText(event.symbol, caps);
    const time = event.at ? `${p.dim(event.at)}  ` : '';
    const roleLabel = p.tone(ROLE_TONE[event.role], `${panelSpeaker(panel, event)}:`);
    let first = `${p.tone(event.tone ?? sym.tone, sym.text)} ${time}${roleLabel} ${p.tone(event.tone ?? 'cream', event.primary)}`;
    if (event.annotation) first = spread(first, renderAnnotation(event.annotation, caps), inner);
    body.push(visibleLength(first) > inner ? truncateVisible(first, inner, caps) : first);
    if (event.secondary) body.push(`  ${p.dim(event.secondary)}`);
  }
  if (body.length === 0) body.push(p.dim('No activity yet.'));

  const lines: string[] = [];
  lines.push(p.tone('goldDim', GLYPHS.tl(caps) + h) + ` ${top} ` + p.tone('goldDim', h.repeat(Math.max(0, width - 5 - visibleLength(top))) + GLYPHS.tr(caps)));
  for (const raw of body) {
    lines.push(`${v} ${padVisible(visibleLength(raw) > inner ? truncateVisible(raw, inner, caps) : raw, inner)} ${v}`);
  }
  lines.push(p.tone('goldDim', GLYPHS.bl(caps) + h.repeat(Math.max(2, width - 2)) + GLYPHS.br(caps)));
  return lines;
}

function panelSpeaker(panel: PanelVM, event: SafeEventVM): string {
  if (panel.role === 'relay') return event.role === 'verification' ? 'Verification' : 'Relay';
  return ROLE_LABEL[event.role].split(' ').map((w) => w[0] + w.slice(1).toLowerCase()).join(' ');
}

/* ----------------------- command bar + footer ------------------------- */

export function renderCommandBar(hint: string, caps: CliCaps, typed = ''): string[] {
  const p = paint(caps);
  const width = contentWidth(caps);
  const h = GLYPHS.hline(caps);
  const inner = width - 4;
  const promptGlyph = p.tone('gold', caps.unicode ? '>_' : '>_');
  const content = typed !== ''
    ? `${promptGlyph} ${p.tone('cream', typed)}${p.tone('gold', '_')}`
    : `${promptGlyph} ${p.dim(hint)}`;
  const send = p.dim('[ENTER] SEND');
  const line = spread(content, send, inner);
  return [
    p.tone('goldDim', GLYPHS.tl(caps) + h.repeat(Math.max(2, width - 2)) + GLYPHS.tr(caps)),
    `${p.tone('goldDim', GLYPHS.vline(caps))} ${padVisible(visibleLength(line) > inner ? truncateVisible(line, inner, caps) : line, inner)} ${p.tone('goldDim', GLYPHS.vline(caps))}`,
    p.tone('goldDim', GLYPHS.bl(caps) + h.repeat(Math.max(2, width - 2)) + GLYPHS.br(caps)),
  ];
}

export function renderFooter(input: {
  caps: CliCaps;
  handoff: string;
  motto: string;
  systems: string;
  dogState: MissionConsoleVM['dog'];
  tick: number;
}): string[] {
  const { caps } = input;
  const p = paint(caps);
  const width = contentWidth(caps);
  const bp = breakpoint(caps.width);
  const dog = footerDog({ state: input.dogState.state, tick: input.tick, caps, trackWidth: bp === 'full' ? 18 : 8 });
  const lines: string[] = [];
  lines.push(spread(p.dim(dog.label), p.tone('cream', dog.track), width));
  const left = `${p.tone('green', GLYPHS.bars(caps))} ${p.tone('cream', input.handoff)}`;
  const motto = p.tone('gold', `[ ${input.motto} ]`);
  const right = `${p.tone('green', input.systems)} ${GLYPHS.paw(caps)}`;
  if (bp === 'full') {
    const line = spread(left, right, width);
    const gap = width - visibleLength(left) - visibleLength(right);
    if (visibleLength(motto) + 2 <= gap) {
      const pad = Math.max(1, Math.floor((gap - visibleLength(motto)) / 2));
      lines.push(`${left}${' '.repeat(pad)}${motto}${' '.repeat(Math.max(1, gap - pad - visibleLength(motto)))}${right}`);
    } else {
      lines.push(line);
    }
  } else {
    lines.push(spread(left, right, width));
    lines.push(motto);
  }
  return lines;
}

/* ------------------------- mission console ---------------------------- */

export function renderMissionConsole(rawVm: MissionConsoleVM, caps: CliCaps, tick = 0, typed = ''): string[] {
  // Fold content glyphs BEFORE layout math so non-Unicode terminals keep
  // border alignment (the fitLines fold remains the final safety net).
  const foldEvent = (e: SafeEventVM): SafeEventVM => (caps.unicode ? e : {
    ...e, primary: asciiFold(e.primary),
    secondary: e.secondary === undefined ? undefined : asciiFold(e.secondary),
    annotation: e.annotation ? { ...e.annotation, text: asciiFold(e.annotation.text) } : undefined,
  });
  const vm: MissionConsoleVM = caps.unicode ? rawVm : {
    ...rawVm,
    stream: rawVm.stream.map(foldEvent),
    panels: rawVm.panels.map((panel) => ({ ...panel, events: panel.events.map(foldEvent) })),
  };
  const p = paint(caps);
  const width = contentWidth(caps);
  const lines: string[] = [];
  lines.push(...renderHeader({ caps, route: vm.route, workforce: vm.workforce, view: vm.view, demo: vm.demo }));
  const live = vm.live ? p.tone('green', `${GLYPHS.dotOn(caps)} LIVE`) : p.tone('amber', `${GLYPHS.dotOn(caps)} OFFLINE DEMO`);
  lines.push(spread(`${live}  ${p.tone('cream', vm.missionLabel)}`,
    `${p.dim('OUTPUT')} ${p.tone('amber', vm.outputVisibility)}  ${p.dim('CALLS')} ${p.tone('cream', `${vm.callBudget.consumed} / ${vm.callBudget.max}`)}`,
    width));
  lines.push('');
  if (vm.view === 'stream') {
    const activeIndex = vm.missionLabel.includes('COMPLETE') ? -1 : vm.stream.length - 1;
    lines.push(...renderStream(vm.stream, caps, activeIndex));
  } else {
    for (const panel of vm.panels) {
      lines.push(...renderPanel(panel, caps, tick));
    }
  }
  lines.push('');
  lines.push(...renderCommandBar(vm.commandHint, caps, typed));
  lines.push(...renderFooter({
    caps, handoff: vm.footer.handoff, motto: vm.footer.motto, systems: vm.footer.systems,
    dogState: vm.dog, tick,
  }));
  return fitLines(lines, caps);
}

/* ------------------------------- home --------------------------------- */

export function renderHome(vm: HomeVM, caps: CliCaps): string[] {
  const p = paint(caps);
  const width = contentWidth(caps);
  const lines: string[] = [];
  lines.push(...renderHeader({ caps, route: vm.route, workforce: null, demo: vm.demo }));
  lines.push(`${p.dim('PROJECT')}`);
  lines.push(`  ${p.tone('cream', vm.projectLine)}`);
  lines.push('');
  lines.push(`${p.dim('HANDOFF NETWORK')}`);
  lines.push(`  ${p.tone(vm.handoffNetwork === 'Standby' ? 'gray' : 'amber', vm.handoffNetwork)}`);
  lines.push('');
  lines.push(p.boldTone('gold', 'RECENT PROJECTS'));
  if (vm.recent.length === 0) {
    lines.push(`  ${p.dim('No projects yet — press [N] to create your first project draft.')}`);
  }
  for (const project of vm.recent) {
    lines.push('');
    lines.push(spread(`  ${p.dim(String(project.index).padStart(2, '0'))}  ${p.tone('cream', project.name)}`,
      p.dim(project.reference), width));
    lines.push(`      ${p.tone(project.stateTone, project.state)} ${p.dim(`· ${project.detail}`)}`);
  }
  lines.push('');
  lines.push(p.boldTone('gold', 'STARTING ROUTES'));
  for (const route of vm.routes) {
    lines.push(`  ${p.dim(String(route.index).padStart(2, '0'))}  ${p.tone('cream', route.label)}`);
  }
  lines.push('');
  lines.push(p.boldTone('gold', 'COMMANDS'));
  lines.push(`  ${vm.commands.map((c) => `${p.tone('gold', `[${c.key}]`)} ${p.tone('cream', c.label)}`).join('   ')}`);
  return fitLines(lines, caps);
}

/* ---------------------------- project home ----------------------------- */

export function renderProjectHome(vm: ProjectHomeVM, caps: CliCaps): string[] {
  const p = paint(caps);
  const width = contentWidth(caps);
  const arrow = caps.unicode ? ' → ' : ' -> ';
  const lines: string[] = [];
  lines.push(...renderHeader({ caps, route: vm.route, workforce: vm.workforce, demo: false, subtitle: `PROJECT / ${vm.name}` }));
  const kv = (k: string, value: string, tone: Parameters<ReturnType<typeof paint>['tone']>[0] = 'cream'): string =>
    `${p.dim(k.padEnd(16))} ${p.tone(tone, value)}`;
  lines.push(kv('STATE', vm.state, vm.stateTone));
  lines.push(kv('MODE', vm.mode, 'gold'));
  lines.push(kv('RESEARCH', vm.research, vm.research === 'RESEARCH NOT CONFIGURED' ? 'gray' : 'amber'));
  lines.push('');
  lines.push(p.dim('PROJECT PHASE'));
  lines.push(`  ${vm.phaseRail.map((phase, i) =>
    (i === vm.phaseIndex ? p.boldTone('gold', phase) : i < vm.phaseIndex ? p.tone('green', phase) : p.dim(phase))).join(arrow)}`);
  lines.push('');
  lines.push(p.dim('CURRENT ACTION'));
  lines.push(`  ${p.tone('cream', vm.currentAction)}`);
  lines.push('');
  lines.push(spread(kv('OUTPUT', vm.outputVisibility, 'amber'),
    `${p.dim('CALL BUDGET')} ${p.tone('cream', `${vm.callBudget.consumed} / ${vm.callBudget.max} consumed`)}`, width));
  lines.push('');
  lines.push(p.boldTone('gold', 'ACTIONS'));
  lines.push(`  ${vm.actions.map((a) => `${p.tone('gold', `[${a.key}]`)} ${p.tone('cream', a.label)}`).join('  ')}`);
  return fitLines(lines, caps);
}

/* --------------------- tasks / findings / evidence --------------------- */

export function renderManualTask(rawTask: ManualTaskVM, caps: CliCaps): string[] {
  const p = paint(caps);
  const task: ManualTaskVM = {
    ...rawTask,
    title: safeSummary(rawTask.title), whyStopped: safeSummary(rawTask.whyStopped),
    approveOutcome: safeSummary(rawTask.approveOutcome), rejectOutcome: safeSummary(rawTask.rejectOutcome),
  };
  return fitLines([
    spread(p.boldTone('gold', `MANUAL TASK / ${task.id}`), p.tone('amber', `STATUS / ${task.status}`), contentWidth(caps)),
    '',
    p.tone('cream', task.title),
    '',
    p.dim('WHY RELAY STOPPED'),
    `  ${p.tone('cream', task.whyStopped)}`,
    '',
    p.dim('WHAT HAPPENS NEXT'),
    `  ${p.tone('green', 'Approve:')} ${p.tone('cream', task.approveOutcome)}`,
    `  ${p.tone('coral', 'Reject:')}  ${p.tone('cream', task.rejectOutcome)}`,
    '',
    `  ${p.tone('gold', '[A]')} Approve   ${p.tone('gold', '[R]')} Reject   ${p.tone('gold', '[D]')} Details   ${p.tone('gold', '[B]')} Back`,
  ], caps);
}

export function renderFinding(rawFinding: FindingVM, caps: CliCaps): string[] {
  const p = paint(caps);
  const finding: FindingVM = {
    ...rawFinding,
    evidence: safeSummary(rawFinding.evidence), requiredAction: safeSummary(rawFinding.requiredAction),
  };
  const tone = finding.status === 'RESOLVED' ? 'green' : 'coral';
  return fitLines([
    spread(p.boldTone('gold', `FINDING ${finding.id}`), p.tone(tone, `STATUS / ${finding.status}`), contentWidth(caps)),
    `  ${p.dim('SEVERITY')}  ${p.tone(finding.severity === 'HIGH' || finding.severity === 'CRITICAL' ? 'coral' : 'amber', finding.severity)}`
      + `   ${p.dim('REVIEWER')}  ${p.tone('cyan', finding.reviewer)}`
      + `   ${p.dim('CRITERIA')}  ${p.tone('cream', finding.criteria.join(', '))}`
      + `   ${p.dim('REVISION')}  ${p.tone('cream', finding.workspaceRevision)}`,
    '',
    p.dim('EVIDENCE'),
    `  ${p.tone('cream', finding.evidence)}`,
    '',
    p.dim('REQUIRED ACTION'),
    `  ${p.tone('cream', finding.requiredAction)}`,
    '',
    `${p.dim('LINKED REPAIR')}  ${p.tone('gold', finding.linkedRepair ?? 'none')}`,
  ], caps);
}

export function renderRepair(rawRepair: RepairVM, caps: CliCaps): string[] {
  const p = paint(caps);
  const repair: RepairVM = { ...rawRepair, requiredChanges: safeSummary(rawRepair.requiredChanges) };
  return fitLines([
    spread(p.boldTone('gold', `REPAIR ${repair.id}`), p.tone(repair.status === 'RESOLVED' ? 'green' : 'amber', `STATUS / ${repair.status}`), contentWidth(caps)),
    `  ${p.dim('FINDING')}  ${p.tone('cream', repair.findingId)}`,
    '',
    p.dim('REQUIRED CHANGES'),
    `  ${p.tone('cream', repair.requiredChanges)}`,
    '',
    p.dim('AUTHORIZED FILES'),
    ...repair.authorizedFiles.map((f) => `  ${p.dim(safePath(f, 60))}`),
  ], caps);
}

export function renderEvidence(evidence: EvidenceVM[], caps: CliCaps): string[] {
  const p = paint(caps);
  const lines: string[] = [p.boldTone('gold', 'VERIFICATION EVIDENCE'), ''];
  for (const record of evidence) {
    lines.push(spread(`${p.tone('gold', record.id)}  ${p.dim('TYPE /')} ${p.tone('cream', record.type)}`,
      `${p.tone(record.status === 'CURRENT' ? 'green' : 'amber', record.status)}  ${p.tone(record.resultTone, record.result)}`,
      contentWidth(caps)));
    lines.push(`     ${p.dim('CRITERIA')} ${p.tone('cream', record.criteria.join(', '))}`
      + `   ${p.dim('REVISION')} ${p.tone('cream', record.revision)}`
      + `   ${p.dim('AUTHORITY')} ${p.tone('cream', record.authority)}`);
    lines.push('');
  }
  return fitLines(lines, caps);
}

/* ------------------------------ recovery ------------------------------- */

export function renderRecovery(vm: RecoveryVM, caps: CliCaps): string[] {
  const p = paint(caps);
  const lines: string[] = [];
  lines.push(vm.required ? p.boldTone('amber', 'RECOVERY REQUIRED') : p.boldTone('green', 'NO RECOVERY REQUIRED'));
  lines.push('');
  const kv = (k: string, value: string, tone: Parameters<ReturnType<typeof paint>['tone']>[0] = 'cream'): string[] =>
    [p.dim(k), `  ${p.tone(tone, value)}`];
  lines.push(...kv('Project:', vm.projectName));
  lines.push(...kv('Interrupted phase:', vm.interruptedPhase, 'amber'));
  lines.push(...kv('Workspace:', vm.workspace, vm.workspace.startsWith('MATCHES') ? 'green' : 'amber'));
  lines.push(...kv('Evidence:', vm.evidence, vm.evidence === 'CURRENT' ? 'green' : 'amber'));
  lines.push(...kv('Open finding:', vm.openFindings.join(', ') || 'none', vm.openFindings.length ? 'coral' : 'green'));
  lines.push(...kv('Repair:', vm.repairs.join(', ') || 'none'));
  lines.push(p.dim('Provider sessions:'));
  for (const session of vm.sessions) {
    lines.push(`  ${p.tone('cream', `${session.provider} ${session.classification}`)}`);
  }
  lines.push(...kv('Call budget:', `${vm.callBudget.consumed} / ${vm.callBudget.max} consumed`));
  lines.push('');
  lines.push(p.boldTone('gold', 'NEXT PERMITTED ACTION'));
  lines.push(`  ${p.tone('cream', vm.nextAction)}`);
  lines.push('');
  lines.push(p.dim('No provider call begins from this screen. Live calls require explicit founder authorization.'));
  return fitLines(lines, caps);
}
