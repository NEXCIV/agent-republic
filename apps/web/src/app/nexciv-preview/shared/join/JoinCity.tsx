'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { SHARED_AVATARS, SHARED_PILOT_NAME, type SharedPilotAvatar, type SharedPilotProfileView } from '@/lib/shared-pilot-profiles';
import type { ModelRunView } from '@/lib/shared-pilot-model';
import { AvatarPreview } from './AvatarPreview';
import styles from './join.module.css';

const city = '/nexciv-preview/shared';
const api = '/api/nexciv-preview/shared';
const endpoint = `${api}?profile=1`;
const appearances = Object.entries(SHARED_AVATARS) as [SharedPilotAvatar, (typeof SHARED_AVATARS)[SharedPilotAvatar]][];
type ProfileView = SharedPilotProfileView & { modelRun: ModelRunView | null; mcpConnected: boolean; mcpScript?: string };
type ConnectionMode = 'mcp' | 'api';
const runLabels: Record<ModelRunView['status'], string> = {
  starting: '正在观察城市，等待模型决策',
  running: 'Agent 自主运行中',
  paused: '已暂停',
  finished: '本轮调用额度或运行时间已用完',
  error: '模型连接或运行失败',
};

export function JoinCity() {
  const router = useRouter();
  const [state, setState] = useState<ProfileView | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [failure, setFailure] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const [mode, setMode] = useState<ConnectionMode | null>(null);
  const [autoEnter, setAutoEnter] = useState<ConnectionMode | null>(null);
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState<SharedPilotAvatar>('citizen');
  const [secret, setSecret] = useState<{ key: string; expiresAt: number } | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [location, setLocation] = useState({ origin: '', port: '3142' });
  const keyField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLocation({ origin: window.location.origin, port: window.location.port || '3142' });
    fetch(endpoint, { cache: 'no-store', signal: controller.signal }).then(async (response) => {
      const view = await response.json();
      if (!response.ok) throw new Error(view.error);
      if (!controller.signal.aborted) {
        setState(view);
        setMode(view.modelRun ? 'api' : view.hasKey ? 'mcp' : null);
      }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setFailure(error instanceof Error ? error.message : '暂时无法读取角色。');
    });
    return () => controller.abort();
  }, [loadAttempt]);

  const profile = state?.profile;
  const residentId = profile?.residentId;
  const run = state?.modelRun;
  const active = run?.status === 'starting' || run?.status === 'running';

  useEffect(() => {
    if (!residentId || pending) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch(endpoint, { cache: 'no-store', signal: controller.signal });
        if (response.ok) {
          const view = await response.json() as ProfileView;
          if (!controller.signal.aborted) setState(view);
        }
      } catch { /* the next poll will retry */ }
      finally { if (!controller.signal.aborted) timer = setTimeout(poll, 1500); }
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [residentId, pending]);

  useEffect(() => {
    if ((autoEnter === 'api' && run?.status === 'running') || (autoEnter === 'mcp' && state?.mcpConnected)) {
      setAutoEnter(null);
      router.replace(city);
    } else if (autoEnter === 'api' && run && ['error', 'paused', 'finished'].includes(run.status)) setAutoEnter(null);
  }, [autoEnter, run, state?.mcpConnected, router]);

  async function change(action: 'claim' | 'issue' | 'revoke' | 'startModel' | 'stopModel') {
    setFailure('');
    setNotice('');
    setPending(true);
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(action === 'claim' ? { action, name, avatar }
          : action === 'startModel' ? { action, baseUrl: baseUrl.trim(), model: model.trim(), apiKey: apiKey.trim() } : { action }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (action === 'claim') {
        setState(result);
        setMode(null);
      } else if (action === 'startModel' || action === 'stopModel') {
        setState((current) => current && { ...current, ...result, hasKey: false });
        setSecret(null);
        setApiKey('');
        setAutoEnter(action === 'startModel' ? 'api' : null);
      } else {
        setState((current) => current && { ...current, hasKey: result.hasKey, modelRun: null, mcpConnected: false });
        setSecret(action === 'issue' ? { key: result.key, expiresAt: result.expiresAt } : null);
        setAutoEnter(action === 'issue' ? 'mcp' : null);
        setNotice(action === 'issue' ? 'MCP 配置已生成。添加到客户端并启动 Agent。' : '凭据已撤销。');
      }
    } catch (error) {
      setFailure(error instanceof Error ? error.message : '操作失败，请重试。');
    } finally {
      setPending(false);
    }
  }

  function claim(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!SHARED_PILOT_NAME.test(name.normalize('NFC').trim())) {
      setFailure('请填写 1 至 24 个字符，可用文字、数字、空格、中点、下划线和短横线。');
    } else {
      void change('claim');
    }
  }

  async function copy(value: string, noticeText: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(noticeText);
    } catch {
      if (value === secret?.key) keyField.current?.select();
      setNotice('请展开配置或选中凭据手动复制。');
    }
  }

  const appearance = profile && SHARED_AVATARS[profile.avatar];
  const mcpConfig = JSON.stringify({ mcpServers: { 'nexciv-shared': { command: 'node',
    args: [state?.mcpScript ?? 'scripts/nexciv-shared-mcp.mjs'],
    env: { NEXCIV_SHARED_PILOT_PORT: location.port, NEXCIV_SHARED_AGENT_KEY: secret?.key ?? '<你的接入凭据>' },
  } } }, null, 2);
  const httpCommand = `POST ${location.origin}${api}\nAuthorization: Bearer <你的接入凭据>\nContent-Type: application/json\n\n{"action":"observe"}`;

  return <section className={styles.desk} aria-labelledby="join-title" lang="zh-CN">
    <h1 id="join-title">{profile ? '连接你的 Agent' : '创建你的居民'}</h1>
    {!state && !failure && <p role="status">正在读取本机试玩状态…</p>}
    {!state && failure && <button className={styles.secondary} type="button" onClick={() => { setFailure(''); setLoadAttempt((attempt) => attempt + 1); }}>重新检查</button>}
    {state && !profile && <form onSubmit={claim} className={styles.form}>
      <AvatarPreview avatar={avatar} />
      <fieldset className={styles.appearances} disabled={pending}>
        <legend>外观</legend>
        <div>
          {appearances.map(([id, preset]) => <label className={styles.appearance} key={id}>
            <input type="radio" name="avatar" value={id} checked={avatar === id} onChange={() => setAvatar(id)} />
            <Image src={preset.portrait} alt="" width={44} height={44} />
            <span>{preset.label}</span>
          </label>)}
        </div>
      </fieldset>
      <label className={styles.field}>角色名
        <input name="name" autoComplete="off" maxLength={24} required disabled={pending} value={name} onChange={(event) => setName(event.target.value)} placeholder="给居民起个名字" />
      </label>
      <button className={styles.primary} disabled={pending} type="submit">{pending ? '正在创建…' : '创建角色，下一步'}</button>
    </form>}
    {profile && appearance && <div className={styles.form}>
      <div className={styles.profile}>
        <Image src={appearance.portrait} alt="" width={64} height={64} />
        <div><strong>{profile.name}</strong><span>{profile.residentId} 号居民 · {appearance.label}外观</span></div>
        <Link className={styles.back} href={city}>进入城市</Link>
      </div>
      <fieldset className={styles.connectionModes} disabled={pending}>
        <legend>选择接入方式</legend>
        <div>
          <label><input type="radio" name="connection" value="mcp" checked={mode === 'mcp'} onChange={() => { setMode('mcp'); setAutoEnter(null); }} />
            <strong>MCP</strong><span>连接已有的 Agent</span></label>
          <label><input type="radio" name="connection" value="api" checked={mode === 'api'} onChange={() => { setMode('api'); setAutoEnter(null); }} />
            <strong>模型 API</strong><span>由 NEXCIV 启动 Agent</span></label>
        </div>
      </fieldset>
      {mode === 'mcp' && <div className={styles.form}>
        <p className={styles.hint}>将生成的 MCP 配置添加到你的本机 Agent 客户端，再启动它并让它持续观察城市。{active && '生成配置会暂停当前 API Agent。'}</p>
        <div className={styles.actions}>
          <button className={styles.primary} disabled={pending} type="button" onClick={() => void change('issue')}>{state.hasKey ? '重新生成 MCP 配置' : '生成 MCP 配置'}</button>
          {state.hasKey && <button className={styles.secondary} disabled={pending} type="button" onClick={() => void change('revoke')}>撤销凭据</button>}
        </div>
        {state.hasKey && <p className={styles.runStatus} role="status">{state.mcpConnected ? 'MCP Agent 最近活跃' : '等待外部 Agent 接入'}</p>}
        {state.hasKey && !secret && <p className={styles.hint}>已有凭据。重新生成会让旧凭据失效。</p>}
        {secret && <div className={styles.secret}>
          <label className={styles.field}>接入凭据
            <input ref={keyField} type="password" value={secret.key} readOnly spellCheck={false} autoComplete="off" />
          </label>
          <button type="button" className={styles.secondary} onClick={() => void copy(secret.key, '已复制接入凭据。')}>复制</button>
          <button type="button" className={styles.primary} onClick={() => void copy(mcpConfig, '已复制 MCP 配置。')}>复制 MCP 配置</button>
          <p className={styles.hint}>刷新后会隐藏。有效期至 {new Date(secret.expiresAt).toLocaleString('zh-CN')}。</p>
        </div>}
        <details className={styles.instructions}><summary>MCP 客户端配置</summary>
          <pre>{mcpConfig}</pre>
          <p>启动后让 Agent 调用 <code>observe_shared_city</code>，自主选择下一步，通过 <code>act_in_shared_city</code> 执行动作，完成后再次观察。</p>
        </details>
        <details className={styles.instructions}><summary>HTTP 客户端配置</summary><pre>{httpCommand}</pre></details>
      </div>}
      {mode === 'api' && <div className={styles.form}>
        {run && <div className={styles.modelStatus} role="status">
          <strong>{runLabels[run.status]}</strong><span>{run.model} · {run.calls}/{run.limit} 次模型调用</span>
          {run.lastAction && <span>最近决策 · {run.lastAction}</span>}
          {run.error && <span className={styles.error}>{run.error}</span>}
        </div>}
        {active ? <button type="button" className={styles.secondary} disabled={pending} onClick={() => void change('stopModel')}>暂停 Agent</button>
          : <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void change('startModel'); }}>
            <label className={styles.field}>API Base URL
              <input name="baseUrl" type="url" required maxLength={512} value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="例如 https://api.openai.com/v1" disabled={pending} />
            </label>
            <label className={styles.field}>模型名称
              <input name="model" required maxLength={160} value={model} onChange={(event) => setModel(event.target.value)} placeholder="服务商提供的模型 ID" disabled={pending} />
            </label>
            <label className={styles.field}>API Key
              <input name="apiKey" type="password" autoComplete="off" required maxLength={512} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="输入你的模型 API Key" disabled={pending} />
            </label>
            <p className={styles.hint}>支持公网 HTTPS 下的 OpenAI 兼容 Chat Completions 接口。每次启动最多 30 次模型调用、30 分钟，按你的模型服务计费。Key 仅用于本次运行。{state.hasKey && '启动将撤销已有 MCP 凭据。'}</p>
            <button type="submit" className={styles.primary} disabled={pending}>{pending ? '正在启动…' : '启动 Agent'}</button>
          </form>}
      </div>}
    </div>}
    {failure && <p className={styles.error} role="alert">{failure}</p>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
  </section>;
}
