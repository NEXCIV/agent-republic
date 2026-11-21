import type { PlannerModelProvider } from './planner.js';

/**
 * E7-03 — hard LLM budget guard (docs/AGENT_ENGINE.md §11).
 *
 * Engineering limits per agent per epoch:
 *   - 1 main decision         (<= 1200 input / 500 output tokens)
 *   - 4 negotiation replies   (<= 700 / 250 each)
 *   - 1 reflection            (<= 1000 / 300)
 *
 * The platform cap is a hard ceiling in micro-USD. A call must reserve its
 * worst-case cost before the provider is touched; the reservation is settled
 * (or released on failure) afterwards. Near the cap, optional discussion stops
 * while owner-facing decisions may continue until the hard ceiling.
 *
 * The provider adapter is still responsible for honouring `maxOutputTokens`;
 * the guard reserves the full configured maximum so a compliant adapter can
 * never exceed the approved spend.
 */

export const AGENT_DAILY_LIMITS = {
  MAIN_DECISION: { calls: 1, inputTokens: 1200, outputTokens: 500 },
  DEBATE_REPLY: { calls: 4, inputTokens: 700, outputTokens: 250 },
  REFLECTION: { calls: 1, inputTokens: 1000, outputTokens: 300 },
} as const;

export type LlmCallKind = keyof typeof AGENT_DAILY_LIMITS;

export type LlmModelPrice = {
  readonly inputUsdPerMillionTokens: number;
  readonly outputUsdPerMillionTokens: number;
};

export type LlmBudgetConfig = {
  /** Hard platform cap for one epoch/day. */
  readonly dailyCostLimitUsd: number;
  readonly prices: Readonly<Record<string, LlmModelPrice>>;
  /** At or above this share, optional discussion calls stop (default 0.8). */
  readonly optionalStopRatio?: number;
  /** Spend already recorded elsewhere (e.g. loaded from `llm_usage`). */
  readonly initialSpentUsd?: number;
};

export type LlmBudgetContext = {
  readonly agentId: string;
  readonly epochId: number;
};

export type LlmBudgetDenialCode =
  | 'INVALID_CONTEXT'
  | 'INPUT_TOO_LARGE'
  | 'AGENT_DAILY_LIMIT'
  | 'OPTIONAL_PAUSED'
  | 'DAILY_LIMIT'
  | 'PRICE_UNKNOWN';

export class LlmBudgetError extends Error {
  readonly code: LlmBudgetDenialCode;

  constructor(code: LlmBudgetDenialCode, message: string) {
    super(`[llm-budget] ${message}`);
    this.name = 'LlmBudgetError';
    this.code = code;
  }
}

export type LlmBudgetReservation = { readonly id: number };

export type LlmUsageRecord = {
  readonly agentId: string;
  readonly epochId: number;
  readonly kind: LlmCallKind;
  readonly model: string;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly costUsd: number;
};

export type LlmBudgetSnapshot = {
  readonly epochId: number | null;
  readonly limitUsd: number;
  readonly spentUsd: number;
  readonly reservedUsd: number;
  readonly remainingUsd: number;
  readonly optionalPaused: boolean;
  readonly hardCapBreached: boolean;
  readonly calls: Readonly<Record<LlmCallKind, number>>;
  readonly denied: Readonly<Record<LlmBudgetDenialCode, number>>;
};

type PendingReservation = {
  readonly agentId: string;
  readonly epochId: number;
  readonly kind: LlmCallKind;
  readonly model: string;
  readonly reservedMicros: number;
  readonly inputCap: number;
  readonly outputCap: number;
  readonly price: LlmModelPrice;
};

const USD_MICROS = 1_000_000;
const DENIAL_CODES: readonly LlmBudgetDenialCode[] = [
  'INVALID_CONTEXT',
  'INPUT_TOO_LARGE',
  'AGENT_DAILY_LIMIT',
  'OPTIONAL_PAUSED',
  'DAILY_LIMIT',
  'PRICE_UNKNOWN',
];

const emptyCalls = (): Record<LlmCallKind, number> => ({
  MAIN_DECISION: 0,
  DEBATE_REPLY: 0,
  REFLECTION: 0,
});

const emptyDenied = (): Record<LlmBudgetDenialCode, number> => {
  const denied = {} as Record<LlmBudgetDenialCode, number>;
  for (const code of DENIAL_CODES) denied[code] = 0;
  return denied;
};

function usdToMicros(usd: number): number {
  if (!Number.isFinite(usd) || usd < 0) {
    throw new LlmBudgetError('INVALID_CONTEXT', 'USD amounts must be finite and non-negative');
  }
  return Math.round(usd * USD_MICROS);
}

/**
 * Micro-USD cost of `tokens`.
 * USD = tokens / 1e6 * price → micro-USD = tokens * price. Rounded up so the
 * guard never under-counts a fractional micro.
 */
function microCost(tokens: number, price: LlmModelPrice, side: 'input' | 'output'): number {
  const perMillion = side === 'input' ? price.inputUsdPerMillionTokens : price.outputUsdPerMillionTokens;
  return Math.ceil(tokens * perMillion);
}

/** Conservative token estimate used when the provider does not report usage. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export class LlmBudgetGuard {
  private readonly limitMicros: number;
  private readonly optionalStopMicros: number;
  private readonly prices: Readonly<Record<string, LlmModelPrice>>;
  private readonly pending = new Map<number, PendingReservation>();
  private nextReservationId = 1;
  private epochId: number | null = null;
  private spentMicros = 0;
  private reservedMicros = 0;
  private calls = emptyCalls();
  private denied = emptyDenied();
  private perAgent = new Map<string, Record<LlmCallKind, number>>();
  private breached = false;

  constructor(config: LlmBudgetConfig) {
    if (!Number.isFinite(config.dailyCostLimitUsd) || config.dailyCostLimitUsd <= 0) {
      throw new LlmBudgetError('INVALID_CONTEXT', 'dailyCostLimitUsd must be a positive number');
    }
    this.limitMicros = usdToMicros(config.dailyCostLimitUsd);
    if (this.limitMicros <= 0) {
      throw new LlmBudgetError('INVALID_CONTEXT', 'dailyCostLimitUsd is below one micro-USD');
    }
    const ratio = config.optionalStopRatio ?? 0.8;
    if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) {
      throw new LlmBudgetError('INVALID_CONTEXT', 'optionalStopRatio must be in (0, 1]');
    }
    this.optionalStopMicros = Math.ceil(this.limitMicros * ratio);
    this.prices = config.prices;
    const initial = config.initialSpentUsd ?? 0;
    if (initial < 0 || !Number.isFinite(initial)) {
      throw new LlmBudgetError('INVALID_CONTEXT', 'initialSpentUsd must be finite and non-negative');
    }
    this.spentMicros = usdToMicros(initial);
    if (this.spentMicros > this.limitMicros) this.breached = true;
  }

  get currentEpoch(): number | null {
    return this.epochId;
  }

  private ensureEpoch(epochId: number): void {
    if (!Number.isInteger(epochId) || epochId < 0) {
      throw new LlmBudgetError('INVALID_CONTEXT', 'epochId must be a non-negative integer');
    }
    if (this.epochId === epochId) return;
    if (this.epochId === null) {
      this.epochId = epochId;
      return;
    }
    // A new epoch is a new daily budget; pending calls cannot span epochs.
    if (this.pending.size > 0) {
      throw new LlmBudgetError('INVALID_CONTEXT', 'cannot roll the epoch while calls are in flight');
    }
    this.epochId = epochId;
    this.spentMicros = 0;
    this.reservedMicros = 0;
    this.calls = emptyCalls();
    this.denied = emptyDenied();
    this.perAgent.clear();
    this.breached = false;
  }

  private deny(code: LlmBudgetDenialCode, detail: string): never {
    this.denied[code] += 1;
    throw new LlmBudgetError(code, detail);
  }

  private agentCalls(agentId: string): Record<LlmCallKind, number> {
    let counters = this.perAgent.get(agentId);
    if (counters === undefined) {
      counters = emptyCalls();
      this.perAgent.set(agentId, counters);
    }
    return counters;
  }

  /** Returns true once the optional-discussion pause threshold is reached. */
  get optionalPaused(): boolean {
    return this.spentMicros + this.reservedMicros >= this.optionalStopMicros;
  }

  begin(
    kind: LlmCallKind,
    context: LlmBudgetContext,
    model: string,
    estimatedInputTokens: number,
  ): LlmBudgetReservation {
    this.ensureEpoch(context.epochId);
    if (
      typeof context.agentId !== 'string' ||
      context.agentId.length === 0 ||
      context.agentId.length > 64
    ) {
      this.deny('INVALID_CONTEXT', 'agentId must be 1..64 characters');
    }
    if (!Number.isInteger(estimatedInputTokens) || estimatedInputTokens < 0) {
      this.deny('INVALID_CONTEXT', 'estimatedInputTokens must be a non-negative integer');
    }

    const limits = AGENT_DAILY_LIMITS[kind];
    if (estimatedInputTokens > limits.inputTokens) {
      this.deny(
        'INPUT_TOO_LARGE',
        `${kind} input ${estimatedInputTokens} exceeds the ${limits.inputTokens}-token cap`,
      );
    }

    const price = this.prices[model];
    if (price === undefined) {
      this.deny('PRICE_UNKNOWN', `no price configured for model "${model}"`);
    }

    const counters = this.agentCalls(context.agentId);
    if (counters[kind] >= limits.calls) {
      this.deny(
        'AGENT_DAILY_LIMIT',
        `${context.agentId} already used ${counters[kind]}/${limits.calls} ${kind} calls this epoch`,
      );
    }

    if (kind === 'DEBATE_REPLY' && this.optionalPaused) {
      this.deny('OPTIONAL_PAUSED', 'optional discussion is paused near the daily cost limit');
    }

    const reserved =
      microCost(limits.inputTokens, price, 'input') +
      microCost(limits.outputTokens, price, 'output');
    if (this.spentMicros + this.reservedMicros + reserved > this.limitMicros) {
      this.deny(
        'DAILY_LIMIT',
        `${kind} would exceed the daily cap of $${(this.limitMicros / USD_MICROS).toFixed(6)}`,
      );
    }

    const id = this.nextReservationId;
    this.nextReservationId += 1;
    this.pending.set(id, {
      agentId: context.agentId,
      epochId: context.epochId,
      kind,
      model,
      reservedMicros: reserved,
      inputCap: limits.inputTokens,
      outputCap: limits.outputTokens,
      price,
    });
    counters[kind] += 1;
    this.calls[kind] += 1;
    this.reservedMicros += reserved;
    return { id };
  }

  finish(
    reservation: LlmBudgetReservation,
    usage: { readonly tokensIn: number; readonly tokensOut: number },
  ): LlmUsageRecord {
    const pending = this.pending.get(reservation.id);
    if (pending === undefined) {
      throw new LlmBudgetError('INVALID_CONTEXT', 'unknown or already settled reservation');
    }
    this.pending.delete(reservation.id);
    this.reservedMicros -= pending.reservedMicros;

    const tokensIn = Math.max(0, Math.trunc(usage.tokensIn));
    const tokensOut = Math.max(0, Math.trunc(usage.tokensOut));
    const actual =
      microCost(Math.min(tokensIn, pending.inputCap), pending.price, 'input') +
      microCost(Math.min(tokensOut, pending.outputCap), pending.price, 'output');

    this.spentMicros += actual;
    if (this.spentMicros > this.limitMicros) this.breached = true;

    return {
      agentId: pending.agentId,
      epochId: pending.epochId,
      kind: pending.kind,
      model: pending.model,
      tokensIn,
      tokensOut,
      costUsd: actual / USD_MICROS,
    };
  }

  cancel(reservation: LlmBudgetReservation): void {
    const pending = this.pending.get(reservation.id);
    if (pending === undefined) return;
    this.pending.delete(reservation.id);
    this.reservedMicros -= pending.reservedMicros;
  }

  callsFor(agentId: string): Readonly<Record<LlmCallKind, number>> {
    return { ...this.agentCalls(agentId) };
  }

  snapshot(): LlmBudgetSnapshot {
    return {
      epochId: this.epochId,
      limitUsd: this.limitMicros / USD_MICROS,
      spentUsd: this.spentMicros / USD_MICROS,
      reservedUsd: this.reservedMicros / USD_MICROS,
      remainingUsd: Math.max(0, this.limitMicros - this.spentMicros - this.reservedMicros) / USD_MICROS,
      optionalPaused: this.optionalPaused,
      hardCapBreached: this.breached,
      calls: { ...this.calls },
      denied: { ...this.denied },
    };
  }
}

/** Charges a completed non-planner call (debate reply, reflection). */
export function spendBudget(
  guard: LlmBudgetGuard,
  kind: LlmCallKind,
  context: LlmBudgetContext,
  model: string,
  tokensIn: number,
  tokensOut: number,
): LlmUsageRecord {
  const reservation = guard.begin(kind, context, model, tokensIn);
  return guard.finish(reservation, { tokensIn, tokensOut });
}

export type BudgetedPlannerOptions = {
  readonly agentId: string;
  readonly epochId: number;
  readonly model: string;
  readonly onUsage?: (usage: LlmUsageRecord) => void;
};

/**
 * Wraps a planner provider so a denied or over-budget call never reaches the
 * model. `planWithProvider` turns the resulting error into ABSTAIN.
 */
export function withLlmBudget(
  provider: PlannerModelProvider,
  guard: LlmBudgetGuard,
  options: BudgetedPlannerOptions,
): PlannerModelProvider {
  return {
    async complete(request) {
      const estimatedInput = estimateTokens(`${request.system}\n${request.user}`);
      const reservation = guard.begin(
        'MAIN_DECISION',
        { agentId: options.agentId, epochId: options.epochId },
        options.model,
        estimatedInput,
      );
      let output: string;
      try {
        output = await provider.complete(request);
      } catch (error) {
        guard.cancel(reservation);
        throw error;
      }
      const usage = guard.finish(reservation, {
        tokensIn: estimatedInput,
        tokensOut: estimateTokens(output),
      });
      options.onUsage?.(usage);
      return output;
    },
  };
}
