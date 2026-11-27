'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { GOALS, PERSONAS } from '@agent-republic/domain';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/States';
import { OwnerCommands } from '@/features/agent-commands/OwnerCommands';
import { formatDateTime } from '@/lib/format';
import type { AgentGoal, AgentPersona, MyAgentView } from '@/lib/types';

/**
 * E3-07 — owner-protected agent console.
 *
 * The owner is never an input: it is resolved by the API from the verified
 * Web2 binding. If no session or binding exists the page says so plainly
 * instead of pretending an owner is signed in.
 */

type LoadState =
  | 'loading'
  | 'unauthenticated'
  | 'binding-required'
  | 'no-agent'
  | 'ready'
  | 'unavailable';

type ConfigForm = { name: string; persona: AgentPersona; goal: AgentGoal };

const DEFAULT_FORM: ConfigForm = { name: '', persona: 'PRAGMATIC', goal: 'BUILD_PUBLIC_GOODS' };

async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: { code?: string; message?: string } };
    if (payload.error?.code === 'OWNER_NOT_ALLOWED') {
      return 'The owner comes from your verified binding and cannot be edited here.';
    }
    if (payload.error?.code === 'VERSION_CONFLICT') {
      return 'Another change was saved first. Reload the console and try again.';
    }
    return payload.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export default function MyAgentPage() {
  const [state, setState] = useState<LoadState>('loading');
  const [view, setView] = useState<MyAgentView | null>(null);
  const [form, setForm] = useState<ConfigForm>(DEFAULT_FORM);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch('/api/my-agent', { cache: 'no-store' });
      if (response.status === 401) {
        setState('unauthenticated');
        return;
      }
      if (response.status === 403) {
        setState('binding-required');
        return;
      }
      if (response.status === 404) {
        setView(null);
        setState('no-agent');
        return;
      }
      if (!response.ok) {
        setState('unavailable');
        return;
      }
      const payload = (await response.json()) as { data: MyAgentView };
      setView(payload.data);
      setForm({ name: payload.data.name, persona: payload.data.persona, goal: payload.data.goal });
      setState('ready');
    } catch {
      setState('unavailable');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    const body = view === null ? form : { ...form, expectedVersion: view.configVersion };
    try {
      const response = await fetch('/api/my-agent/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setError(await errorMessage(response, 'Could not save the agent configuration.'));
        return;
      }
      await load();
      setNotice('Saved as a new immutable configuration version.');
    } catch {
      setError('Could not reach the agent console API.');
    } finally {
      setBusy(false);
    }
  };

  const togglePause = async () => {
    if (view === null) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const next = view.status !== 'PAUSED';
    try {
      const response = await fetch('/api/my-agent/pause', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paused: next }),
      });
      if (!response.ok) {
        setError(await errorMessage(response, 'Could not change the agent status.'));
        return;
      }
      await load();
      setNotice(next ? 'Agent paused. New actions stop until you resume.' : 'Agent resumed.');
    } catch {
      setError('Could not reach the agent console API.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="正式身份 · Agent 工作台"
        title="Agent 指令与设置"
        lede="已绑定身份的玩家可以提交指令、查看执行报告，以及管理 Agent 的目标和配置。"
        meta={['已验证的持有人身份', '配置保留历史版本']}
      >
        <Link className="button" href="/agent-console/demo">试用指令演示</Link>
      </PageHeader>

      {notice !== null ? <div className="panel hint">{notice}</div> : null}
      {error !== null ? <div className="error-banner">{error}</div> : null}

      {state === 'loading' ? <p className="hint" role="status">正在加载 Agent 工作台…</p> : null}

      {state === 'unauthenticated' ? (
        <div className="panel">
          <h2>Session required</h2>
          <p>
            The console exposes private agent configuration only after a verified Web2 session. No wallet key,
            seed phrase or signature is requested on this page.
          </p>
          <p className="hint">
            Sign-in has not been connected in this build yet, so the console stays locked instead of guessing an
            owner — that is the intended safe state. Once a session provider is wired in, this page shows the
            configuration form, pause control, version history and recent actions.
          </p>
        </div>
      ) : null}

      {state === 'binding-required' ? (
        <div className="panel">
          <h2>Agent ID binding required</h2>
          <p>
            This account has no confirmed binding. The owner address can only come from a finalized
            CitizenRegistered event; it cannot be supplied through this form.
          </p>
          <p className="hint">
            Bind your Agent ID owner wallet first. Until then the console stays read-empty rather than guessing an
            owner.
          </p>
        </div>
      ) : null}

      {state === 'unavailable' ? (
        <div className="error-banner">
          正式工作台服务暂未连接。本机试玩可以从「角色与接入」继续。
        </div>
      ) : null}

      {state === 'ready' && view !== null ? (
        <>
          <OwnerCommands key={`${view.agentId}:${view.configVersion}`} name={view.name} paused={view.status === 'PAUSED'} />
          <div className="row" style={{ marginBottom: 16 }}>
            <span className={`badge ${view.status === 'ACTIVE' ? 'confirmed' : 'pending'}`}>{view.status}</span>
            <span className="hint">agent {view.agentId} · updated {formatDateTime(view.updatedAt)}</span>
          </div>

          <div className="grid">
            <div className="stat">
              <div className="label">Owner (from binding)</div>
              <div className="value mono" style={{ fontSize: 13 }}>
                {view.owner}
              </div>
            </div>
            <div className="stat">
              <div className="label">Config version</div>
              <div className="value">{view.configVersion}</div>
            </div>
            <div className="stat">
              <div className="label">Created</div>
              <div className="value" style={{ fontSize: 13 }}>
                {formatDateTime(view.createdAt)}
              </div>
            </div>
          </div>
        </>
      ) : null}

      {state === 'no-agent' ? (
        <div className="panel">
          <h2>No agent yet</h2>
          <p>
            Your binding is confirmed but no agent exists for this owner. Saving the form below creates version 1 and
            activates it.
          </p>
        </div>
      ) : null}

      {state === 'ready' || state === 'no-agent' ? (
        <form className="panel" onSubmit={save}>
          <h2 style={{ marginTop: 0 }}>{view === null ? 'Activate agent' : 'Replace configuration'}</h2>
          <div className="field-grid">
            <div className="field">
              <label htmlFor="agent-name">Agent name</label>
              <input
                id="agent-name"
                maxLength={64}
                required
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="agent-persona">Persona</label>
              <select
                id="agent-persona"
                value={form.persona}
                onChange={(event) => setForm({ ...form, persona: event.target.value as AgentPersona })}
              >
                {PERSONAS.map((persona) => (
                  <option key={persona} value={persona}>
                    {persona}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="agent-goal">Goal</label>
              <select
                id="agent-goal"
                value={form.goal}
                onChange={(event) => setForm({ ...form, goal: event.target.value as AgentGoal })}
              >
                {GOALS.map((goal) => (
                  <option key={goal} value={goal}>
                    {goal}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="hint">
            Old versions are never rewritten. Replacing the AI changes this agent, not your owner identity.
          </p>
          <div className="actions">
            <button className="primary" type="submit" disabled={busy}>
              {view === null ? 'Create agent' : 'Save new version'}
            </button>
            {view !== null ? (
              <button type="button" onClick={togglePause} disabled={busy}>
                {view.status === 'PAUSED' ? 'Resume agent' : 'Pause agent'}
              </button>
            ) : null}
          </div>
        </form>
      ) : null}

      {state === 'ready' && view !== null ? (
        <>
          <h2>Configuration history</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Version</th>
                  <th scope="col">Name</th>
                  <th scope="col">Persona</th>
                  <th scope="col">Goal</th>
                  <th scope="col">Paused</th>
                  <th scope="col">Created</th>
                </tr>
              </thead>
              <tbody>
                {view.versions.map((entry) => (
                  <tr key={entry.version}>
                    <td>v{entry.version}</td>
                    <td>{entry.name}</td>
                    <td>{entry.persona}</td>
                    <td>{entry.goal}</td>
                    <td>{entry.paused ? 'yes' : 'no'}</td>
                    <td className="hint">{formatDateTime(entry.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2>Recent actions</h2>
          {view.recentActions.length === 0 ? (
            <EmptyState
              title="No action intents yet"
              detail="Intents appear here after the agent proposes an action. Pending never means confirmed."
            />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Type</th>
                    <th scope="col">Status</th>
                    <th scope="col">Target</th>
                    <th scope="col">Tx</th>
                    <th scope="col">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {view.recentActions.map((action) => (
                    <tr key={action.id}>
                      <td>{action.actionType}</td>
                      <td>{action.status}</td>
                      <td>{action.targetId ?? '—'}</td>
                      <td className="hash">{action.txHash ?? '—'}</td>
                      <td className="hint">{formatDateTime(action.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </>
  );
}
