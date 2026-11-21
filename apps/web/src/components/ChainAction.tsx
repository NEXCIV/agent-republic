'use client';

import { useEffect, useMemo, useState } from 'react';
import { encodeCastVote, encodeContribution } from '@agent-republic/chain';
import type { VoteChoice } from '@agent-republic/domain';

/**
 * Wallet-facing action panel (E2-06 "准备/确认链上操作").
 *
 * Rules encoded here:
 * - The API is not involved in signing; calldata is derived locally from the
 *   documented ABI and shown to the user before anything is sent.
 * - We do NOT assume an injected wallet exists (AGENTS.md §2). Without one,
 *   the panel shows the raw calldata for the user's own wallet path.
 * - A returned txHash is displayed as PENDING, never as success.
 */

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

type Props =
  | { kind: 'vote'; chainId: number; to: string; proposalId: string }
  | { kind: 'contribute'; chainId: number; to: string; projectId: string; maxAmount?: bigint };

export function ChainAction(props: Props) {
  const [choice, setChoice] = useState<VoteChoice>('YES');
  const [amount, setAmount] = useState('10');
  const [hasProvider, setHasProvider] = useState(false);
  const [pending, setPending] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const injected = (window as unknown as { ethereum?: Eip1193Provider }).ethereum;
    setHasProvider(injected !== undefined);
  }, []);

  const amountExceedsGoal =
    props.kind === 'contribute' &&
    props.maxAmount !== undefined &&
    /^\d+$/.test(amount) &&
    BigInt(amount) > props.maxAmount;

  const data = useMemo(() => {
    try {
      if (props.kind === 'vote') {
        return encodeCastVote({ proposalId: BigInt(props.proposalId), choice });
      }
      if (!/^\d+$/.test(amount) || amount === '0') return null;
      return encodeContribution({ projectId: BigInt(props.projectId), amount: BigInt(amount) });
    } catch {
      return null;
    }
    // props carries the discriminated kind; identity is stable per render tree.
  }, [props, choice, amount]);

  const send = async () => {
    setError(null);
    const injected = (window as unknown as { ethereum?: Eip1193Provider }).ethereum;
    if (injected === undefined || data === null) return;
    setPending(true);
    try {
      const accounts = (await injected.request({ method: 'eth_requestAccounts' })) as string[];
      const from = accounts[0];
      if (from === undefined) throw new Error('wallet returned no account');
      const hash = (await injected.request({
        method: 'eth_sendTransaction',
        params: [{ from, to: props.to, data, value: '0x0' }],
      })) as string;
      setTxHash(hash);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'wallet rejected the request');
    } finally {
      setPending(false);
    }
  };

  const copy = async () => {
    if (data === null) return;
    await navigator.clipboard.writeText(data);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="panel">
      <h2 style={{ marginTop: 0 }}>{props.kind === 'vote' ? 'Cast a vote' : 'Contribute BUILD'}</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        Signed by your own wallet — this app never holds keys or submits transactions for you.
      </p>

      <div className="actions">
        {props.kind === 'vote' ? (
          <label>
            Choice{' '}
            <select value={choice} onChange={(event) => setChoice(event.target.value as VoteChoice)}>
              <option value="YES">YES</option>
              <option value="NO">NO</option>
              <option value="ABSTAIN">ABSTAIN</option>
            </select>
          </label>
        ) : (
          <label>
            Amount (BUILD){' '}
            <input
              value={amount}
              onChange={(event) => setAmount(event.target.value.trim())}
              inputMode="numeric"
              style={{ width: 110 }}
            />
          </label>
        )}
        <button type="button" onClick={copy} disabled={data === null || amountExceedsGoal}>
          {copied ? 'Copied' : 'Copy calldata'}
        </button>
        {hasProvider ? (
          <button type="button" className="primary" onClick={send} disabled={pending || data === null || amountExceedsGoal}>
            {pending ? 'Waiting for wallet…' : 'Send with browser wallet'}
          </button>
        ) : (
          <span className="hint">
            No injected wallet detected. Use the calldata below in the wallet that holds your Agent ID.
          </span>
        )}
      </div>

      {props.kind === 'contribute' ? (
        <p className="hint" style={{ margin: '10px 0 0' }}>
          {props.maxAmount !== undefined
            ? `Remaining toward the goal: ${props.maxAmount} BUILD. A contribution cannot exceed it, and it also cannot exceed your own BUILD balance — the contract rejects both.`
            : 'A contribution cannot exceed your own BUILD balance; the contract rejects anything above it.'}
          {amountExceedsGoal ? ' This amount exceeds the remaining goal.' : ''}
        </p>
      ) : null}

      <p className="hint" style={{ marginBottom: 0 }}>
        Prepared calldata (chainId {props.chainId}, value 0):
      </p>
      <code className="calldata" aria-label="Prepared transaction calldata">
        {data ?? 'invalid parameters'}
      </code>

      {error !== null ? (
        <div className="error-banner" role="alert">
          {error}
        </div>
      ) : null}

      {txHash !== null ? (
        <div className="panel" style={{ marginBottom: 0 }} role="status" aria-live="polite">
          <span className="badge pending">TRANSACTION PENDING</span>
          <p className="hash" style={{ marginBottom: 4 }}>
            {txHash}
          </p>
          <p className="hint" style={{ margin: 0 }}>
            Submitted — not confirmed. Status advances only when the indexer sees a finalized event:{' '}
            <a href={`/tx/${txHash}`}>view status</a>
          </p>
        </div>
      ) : null}
    </div>
  );
}
