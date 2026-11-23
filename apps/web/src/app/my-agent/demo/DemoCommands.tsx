'use client';

import { useEffect, useState } from 'react';
import { AGENT_LOCATIONS, commandRecordSchema, type CommandRequest } from '@agent-republic/domain';
import { CommandConsole } from '@/features/agent-commands/CommandConsole';
import { advanceDemoCommands, submitDemoCommand, type DemoCommandState } from '@/lib/command-demo';

const STORAGE = 'civrum.demo.commands.v2';
const historySchema = commandRecordSchema.array();
const initial: DemoCommandState = { history: [], location: 'PLAZA' };

function decode(saved: string): DemoCommandState {
  const value: unknown = JSON.parse(saved);
  if (typeof value === 'object' && value !== null && 'location' in value && 'history' in value) {
    const location = AGENT_LOCATIONS.find((item) => item === value.location);
    if (location) return { history: historySchema.parse(value.history), location };
  }
  throw new Error('Invalid demo session.');
}

export function DemoCommands() {
  const [state, setState] = useState<DemoCommandState | null>(null);
  const [issue, setIssue] = useState<string | null>(null);
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE);
      setState(saved ? decode(saved) : initial);
    } catch {
      setIssue('Saved demo history could not be opened. A fresh session is ready.');
      setState(initial);
    }
  }, []);

  useEffect(() => {
    if (state === null) return;
    try {
      sessionStorage.setItem(STORAGE, JSON.stringify(state));
    } catch {
      setIssue('Tab storage is unavailable. This demo session will last until you leave the page.');
    }
    if (!state.history.some((entry) => entry.status === 'RUNNING')) return;
    const timer = setTimeout(() => {
      try {
        setState(advanceDemoCommands(state));
      } catch {
        setIssue('The demo could not advance this task. Reload to retry.');
      }
    }, 1600);
    return () => clearTimeout(timer);
  }, [state]);

  function submit(request: CommandRequest) {
    if (state === null) throw new Error('The demo is still loading.');
    setState(submitDemoCommand(state, request));
  }

  return <CommandConsole name="Ada" demo location={state?.location} history={state?.history ?? null} issue={issue} submit={submit} />;
}
