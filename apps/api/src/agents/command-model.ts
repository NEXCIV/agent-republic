import { AGENT_DAILY_LIMITS } from '@agent-republic/agent-engine';
import type { ModelCallReservation } from './command-store.js';

type RequestKey = Pick<ModelCallReservation, 'agentId' | 'requestKey' | 'kind'>;
type Prompt = { system: string; user: string };

/** Optional inference on an installed Ollama model. No URL, tools or credentials come from a command. */
export class LocalCommandModel {
  constructor(
    private readonly model: string,
    private readonly maxDailyCalls: number,
    private readonly reserve: (call: ModelCallReservation) => Promise<boolean>,
    private readonly transport: typeof fetch = fetch,
  ) {
    if (!/^[\w.-]+(?::[\w.-]+)?$/.test(model) || /cloud/i.test(model)) {
      throw new Error('COMMAND_LOCAL_MODEL must name an installed local model.');
    }
    if (!Number.isSafeInteger(maxDailyCalls) || maxDailyCalls < 1 || maxDailyCalls > 1000) {
      throw new Error('COMMAND_MODEL_DAILY_CALLS must be an integer from 1 to 1000.');
    }
  }

  async complete(call: RequestKey, prompt: Prompt): Promise<string | null> {
    const limits = AGENT_DAILY_LIMITS[call.kind];
    if (Buffer.byteLength(prompt.system) + Buffer.byteLength(prompt.user) + 32 > limits.inputTokens) return null;
    const post = (path: 'show' | 'chat', body: Record<string, unknown>) => this.transport(
      'http://127.0.0.1:11434/api/' + path,
      { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(10_000), body: JSON.stringify(body) },
    );
    try {
      // Ollama can also proxy cloud models, including locally named aliases.
      // Verify local model metadata before sending any private text.
      const model = await post('show', { model: this.model });
      if (!model.ok) return null;
      const info = await model.json() as {
        remote_model?: string; remote_host?: string; model_info?: Record<string, unknown>;
      };
      if (info.remote_model || info.remote_host || !info.model_info?.['general.architecture']) return null;
      if (!await this.reserve({ ...call, model: this.model, maxDailyCalls: this.maxDailyCalls })) return null;
      const response = await post('chat', {
        model: this.model, stream: false, format: 'json',
        messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }],
        options: { num_predict: limits.outputTokens, num_ctx: limits.inputTokens + limits.outputTokens },
      });
      if (!response.ok) return null;
      const data = await response.json() as { done?: boolean; message?: { content?: unknown } };
      const content = data.message?.content;
      return data.done === true && typeof content === 'string' && content.length <= 6000 ? content : null;
    } catch {
      // The durable reservation remains spent even if inference timed out.
      return null;
    }
  }
}
