'use client';

import { useRef, useState, type FormEvent } from 'react';
import {
  commandRequestSchema,
  type AgentLocation, type CommandMode, type CommandRecord, type CommandRequest, type CommandStep,
} from '@agent-republic/domain';
import { formatDateTime } from '@/lib/format';
import { LANDMARK_LABELS } from '../world-3d/webgl';
import { CommandRoute } from './CommandRoute';
import styles from './commands.module.css';

const MODES = {
  SUGGEST: { name: 'Suggest', detail: 'Your agent decides whether the task fits its goals.' },
  EXECUTE: { name: 'Execute', detail: 'Give this task priority over free activity.' },
  INTERRUPT: { name: 'Interrupt', detail: 'Pause the current task, run this one, then resume.' },
} satisfies Record<CommandMode, { name: string; detail: string }>;

const STATUS = {
  RUNNING: 'Working', PAUSED: 'Paused', DECLINED: 'Declined', COMPLETED: 'Completed', FAILED: 'Stopped',
};

function stepLabel(step: CommandStep): string {
  switch (step.kind) {
    case 'VISIT': return `Visit ${LANDMARK_LABELS[step.location]}`;
    case 'DISCUSS': return `Speak with ${step.targetAgentId}`;
    case 'REVIEW': {
      const label = { PROJECTS: 'public projects', PROPOSALS: 'council proposals', DISTRICT: 'the district' }[step.subject];
      return `Review ${label}${step.itemId ? ` (#${step.itemId})` : ''}`;
    }
    case 'REPORT': return 'Report back';
  }
}

function JournalEntry({ entry, expanded }: { entry: CommandRecord; expanded: boolean }) {
  return (
    <details className={styles.entry} open={expanded}>
      <summary>
        <span className={styles.summaryText}>{entry.text}</span>
        <span className="badge">{STATUS[entry.status]}</span>
      </summary>
      <p className="hint">
        {MODES[entry.mode].name} · Config v{entry.configVersion} · Observed block {entry.sourceBlock} ·{' '}
        <time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time>
      </p>
      <CommandRoute entry={entry} />
      {entry.steps.length > 0 && (
        <ol className={styles.steps} aria-label="Task plan">
          {entry.steps.map((step, index) => {
            const result = entry.results[index];
            const current = index === entry.results.length && entry.status === 'RUNNING';
            return (
              <li key={index} aria-current={current ? 'step' : undefined}>
                <strong>{stepLabel(step)}</strong>
                {current && <span className={styles.current}>In progress</span>}
                {result !== undefined && step.kind !== 'REPORT' && <p>{result}</p>}
              </li>
            );
          })}
        </ol>
      )}
      {entry.report && <div className={styles.report}><h3>Task report</h3><p>{entry.report}</p></div>}
    </details>
  );
}

type CommandConsoleProps = {
  name: string;
  demo?: boolean;
  paused?: boolean;
  initialDraft?: string;
  location?: AgentLocation;
  history: CommandRecord[] | null;
  issue?: string | null;
  retry?: () => void;
  submit: (request: CommandRequest) => Promise<void> | void;
};

export function CommandConsole({ name, demo, paused, initialDraft = '', location, history, issue, retry, submit }: CommandConsoleProps) {
  const [text, setText] = useState(initialDraft);
  const [mode, setMode] = useState<CommandMode>('EXECUTE');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draft = useRef<CommandRequest | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const inFlight = useRef(false);
  const active = history?.find((entry) => entry.status === 'RUNNING');
  const disabled = Boolean(paused) || history === null || sending;
  const quick = [
    { label: 'Visit Council Hall', text: '前往议会厅，然后向我汇报。' },
    { label: 'Review proposals', text: '了解当前治理提案' },
    demo
      ? { label: 'Talk to Borealis', text: '去中央广场找 Borealis，聊一下建设项目，然后向我汇报。' }
      : { label: 'Review construction', text: '查看公共建设项目进度' },
  ];

  async function send(event: FormEvent) {
    event.preventDefault();
    if (disabled || inFlight.current) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    inFlight.current = true;
    setSending(true);
    setError(null);
    try {
      // Keep the request key if the reply is lost and the player retries this draft.
      if (!draft.current || draft.current.text !== trimmed || draft.current.mode !== mode) {
        const parsed = commandRequestSchema.safeParse({ text: trimmed, mode, requestId: crypto.randomUUID() });
        if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Check your command.');
        draft.current = parsed.data;
      }
      await submit(draft.current);
      setText('');
      draft.current = null;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not send the command. Try again.');
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  return (
    <div className={styles.console}>
      <section className={styles.composer} aria-labelledby="command-title">
        <div className="row">
          {demo && <span className="stamp">DEMO</span>}
          <span className="badge">AI SIMULATED</span>
          {location && <span className="hint">Private location · {LANDMARK_LABELS[location]}</span>}
        </div>
        <h2 id="command-title">Direct {name}</h2>
        <p>Send a task in English or Chinese. Your agent can visit a place, discuss a project or report on a proposal.</p>
        <form onSubmit={send}>
          <label htmlFor="command-text">Command</label>
          <textarea id="command-text" ref={input} value={text} rows={3} maxLength={500} required
            disabled={disabled} placeholder="What should your agent do?"
            onChange={(event) => { setText(event.target.value); setError(null); }} />
          <div className={styles.examples} role="group" aria-label="Example commands">
            {quick.map((example) => (
              <button key={example.label} type="button" disabled={disabled}
                onClick={() => { setText(example.text); setError(null); input.current?.focus(); }}>
                {example.label}
              </button>
            ))}
          </div>
          <label htmlFor="command-mode">Command mode</label>
          <select id="command-mode" value={mode} disabled={disabled} aria-describedby="command-mode-help"
            onChange={(event) => setMode(event.target.value as CommandMode)}>
            {Object.entries(MODES).map(([value, option]) => <option key={value} value={value}>{option.name}</option>)}
          </select>
          <p className="hint" id="command-mode-help">{MODES[mode].detail}</p>
          {paused && <p role="status">Resume your agent in its configuration to send another task.</p>}
          {active && !paused && mode !== 'INTERRUPT' && <p className="hint">A task is running. Choose Interrupt to start a new task now.</p>}
          {error && <p className="error-banner" role="alert">{error}</p>}
          <button className="primary" type="submit"
            disabled={disabled || !text.trim() || Boolean(active && mode !== 'INTERRUPT')}>
            {sending ? 'Sending…' : 'Send command'}
          </button>
        </form>
      </section>
      <section className={styles.journal} aria-labelledby="command-history">
        <h2 id="command-history">Command history</h2>
        <p className="hint">{demo ? 'Saved in this browser tab.' : 'Visible only to the bound owner.'}</p>
        {issue && <div className="error-banner" role="alert">{issue} {retry && <button type="button" onClick={retry}>Retry</button>}</div>}
        <p className={styles.status} role="status">
          {history === null ? (issue ? 'History unavailable' : 'Loading commands…')
            : paused ? 'Agent paused' : active ? `Working · ${active.results.length} of ${active.steps.length} steps complete`
            : history.length ? `Latest task · ${STATUS[history[0]!.status]}` : 'No tasks yet'}
        </p>
        {history?.map((entry, index) => <JournalEntry key={entry.id} entry={entry} expanded={index === 0} />)}
      </section>
    </div>
  );
}
