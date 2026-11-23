'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { commandRecordSchema, type CommandRecord, type CommandRequest } from '@agent-republic/domain';
import { CommandConsole } from './CommandConsole';
import { draftFromWorld } from './world-command';

const ENDPOINT = '/api/my-agent/commands';
const records = commandRecordSchema.array();

export function OwnerCommands({ name, paused }: { name: string; paused: boolean }) {
  const params = useSearchParams();
  const initialDraft = draftFromWorld(params.get('visit'), params.get('meet'));
  const [history, setHistory] = useState<CommandRecord[] | null>(null);
  const [issue, setIssue] = useState<string | null>(null);
  const newestRead = useRef(0);

  const refresh = useCallback(async () => {
    const read = ++newestRead.current;
    try {
      const response = await fetch(ENDPOINT, { cache: 'no-store' });
      if (read !== newestRead.current) return;
      if (response.status === 401 || response.status === 403) {
        setHistory(null);
        throw new Error('The verified owner session is required. Sign in and reload the console.');
      }
      if (!response.ok) throw new Error('Could not refresh the private command history.');
      const payload = await response.json();
      if (read !== newestRead.current) return;
      setHistory(records.parse(payload.data));
      setIssue(null);
    } catch (reason) {
      if (read === newestRead.current) {
        setIssue(reason instanceof Error && !(reason instanceof TypeError) && reason.name !== 'ZodError'
          ? reason.message : 'Private command history is unavailable.');
      }
    }
  }, []);

  const working = history?.some((entry) => entry.status === 'RUNNING' || entry.status === 'PAUSED');
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      await refresh();
      if (!cancelled) timer = setTimeout(() => { void poll(); }, working ? 1500 : 12000);
    }
    void poll();
    return () => { cancelled = true; newestRead.current++; clearTimeout(timer); };
  }, [refresh, working]);

  async function submit(request: CommandRequest) {
    let response: Response;
    try {
      response = await fetch(ENDPOINT, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
        cache: 'no-store',
      });
    } catch {
      throw new Error('The reply was interrupted. Retry this command to check whether it was saved.');
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      await refresh();
      throw new Error(payload?.error?.message ?? 'Could not send the command. Refresh and try again.');
    }
    const entry = commandRecordSchema.parse((await response.json()).data);
    newestRead.current++;
    setHistory((previous) => [entry, ...(previous ?? []).filter((other) => other.id !== entry.id)]);
    await refresh();
  }

  return <CommandConsole key={initialDraft} name={name} initialDraft={initialDraft} paused={paused} history={history} issue={issue}
    retry={() => { void refresh(); }} submit={submit} />;
}
