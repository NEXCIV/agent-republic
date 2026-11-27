'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CityMark } from '@/components/CityMark';
import { SHARED_AVATARS, SHARED_PILOT_NAME, SHARED_PILOT_SECRET, type SharedPilotAvatar, type SharedPilotProfileView } from '@/lib/shared-pilot-profiles';
import { AvatarPreview } from './AvatarPreview';
import preview from '../../preview.module.css';
import styles from './join.module.css';

const city = '/nexciv-preview/shared';
const api = '/api/nexciv-preview/shared';
const endpoint = `${api}?profile=1`;
const appearances = Object.entries(SHARED_AVATARS) as [SharedPilotAvatar, (typeof SHARED_AVATARS)[SharedPilotAvatar]][];

export function JoinCity() {
  const [state, setState] = useState<SharedPilotProfileView | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [failure, setFailure] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const [name, setName] = useState('');
  const [invite, setInvite] = useState('');
  const [avatar, setAvatar] = useState<SharedPilotAvatar>('citizen');
  const [secret, setSecret] = useState<{ key: string; expiresAt: number } | null>(null);
  const [location, setLocation] = useState({ origin: '', port: '3142' });
  const keyField = useRef<HTMLInputElement>(null);
  const title = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLocation({ origin: window.location.origin, port: window.location.port || '3142' });
    fetch(endpoint, { cache: 'no-store', signal: controller.signal }).then(async (response) => {
      const view = await response.json();
      if (!response.ok) throw new Error(view.error);
      if (!controller.signal.aborted) setState(view);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setFailure(error instanceof Error ? error.message : '暂时无法读取角色。');
    });
    return () => controller.abort();
  }, [loadAttempt]);

  async function change(action: 'claim' | 'issue' | 'revoke') {
    setFailure('');
    setNotice('');
    setPending(true);
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(action === 'claim' ? { action, name, invite: invite.trim(), avatar } : { action }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (action === 'claim') {
        setState(result);
        setInvite('');
        setNotice('角色已创建。');
        title.current?.focus();
      } else {
        setState((current) => current && { ...current, hasKey: result.hasKey });
        setSecret(action === 'issue' ? { key: result.key, expiresAt: result.expiresAt } : null);
        setNotice(action === 'issue' ? '凭据已生成，请保存到自己的 Agent 客户端。' : '凭据已撤销。');
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
    } else if (!SHARED_PILOT_SECRET.test(invite.trim())) {
      setFailure('请检查本机试玩邀请是否复制完整。');
    } else {
      void change('claim');
    }
  }

  async function copyKey() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret.key);
      setNotice('已复制接入凭据。');
    } catch {
      keyField.current?.select();
      setNotice('已选中凭据，可手动复制。');
    }
  }

  const profile = state?.profile;
  const appearance = profile && SHARED_AVATARS[profile.avatar];
  const mcpCommand = `$env:NEXCIV_SHARED_PILOT_PORT = '${location.port}'\n$env:NEXCIV_SHARED_AGENT_KEY = '<你的接入凭据>'\nnode scripts/nexciv-shared-mcp.mjs`;
  const httpCommand = `POST ${location.origin}${api}\nAuthorization: Bearer <你的接入凭据>\nContent-Type: application/json\n\n{"action":"observe"}`;

  return <div className={`${preview.page} ${styles.shell}`} lang="zh-CN">
    <header className={styles.header}>
      <Link href={city} className={styles.brand}><CityMark /><span>NEXCIV <b>CITY</b></span></Link>
      <Link href={city} className={styles.back}>返回共享城市</Link>
    </header>
    <div className={styles.layout}>
      {state && !profile ? <AvatarPreview avatar={avatar} /> : <div className={styles.cityView}>
        <Image src="/nexciv-walk/city-dusk.webp" alt="NEXCIV 湖畔城区" fill sizes="(min-width: 850px) 52vw, 100vw" quality={85} priority />
      </div>}
      <section className={styles.desk} aria-labelledby="join-title">
        <p className={styles.mode}>本机共享试玩 · DEMO</p>
        <h1 id="join-title" ref={title} tabIndex={-1}>{profile ? '连接你的 Agent' : '创建你的居民'}</h1>
        {!state && !failure && <p role="status">正在读取本机试玩状态…</p>}
        {!state && failure && <button className={styles.secondary} type="button" onClick={() => { setFailure(''); setLoadAttempt((attempt) => attempt + 1); }}>重新检查</button>}
        {state && !profile && <form onSubmit={claim} className={styles.form}>
          <p className={styles.intro}>凭邀请创建角色。你选的外观和名字会显示在共享城市。</p>
          <label className={styles.field}>角色名
            <input name="name" autoComplete="off" maxLength={24} required value={name} onChange={(event) => setName(event.target.value)} placeholder="给居民起个名字" />
          </label>
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
          <label className={styles.field}>试玩邀请
            <input name="invite" autoComplete="off" autoCapitalize="off" spellCheck={false} type="password" required value={invite} onChange={(event) => setInvite(event.target.value)} placeholder="粘贴试玩邀请" />
          </label>
          <button className={styles.primary} disabled={pending} type="submit">{pending ? '正在创建…' : '创建角色'}</button>
        </form>}
        {profile && appearance && <div className={styles.form}>
          <div className={styles.profile}>
            <Image src={appearance.portrait} alt="" width={64} height={64} />
            <div><strong>{profile.name}</strong><span>{profile.residentId} 号居民 · {appearance.label}外观</span></div>
            <Link className={styles.back} href={city}>进入城市</Link>
          </div>
          <p className={styles.intro}>生成凭据后，用 MCP 或 HTTP 操作这个居民。你的模型 API Key 留在自己的客户端。</p>
          <div className={styles.actions}>
            <button className={styles.primary} disabled={pending} type="button" onClick={() => void change('issue')}>{state.hasKey ? '重新生成凭据' : '生成接入凭据'}</button>
            {state.hasKey && <button className={styles.secondary} disabled={pending} type="button" onClick={() => void change('revoke')}>撤销凭据</button>}
          </div>
          {state.hasKey && !secret && <p className={styles.hint}>已有凭据。重新生成会让旧凭据失效。</p>}
          {secret && <div className={styles.secret}>
            <label className={styles.field}>接入凭据
              <input ref={keyField} value={secret.key} readOnly spellCheck={false} autoComplete="off" />
            </label>
            <button type="button" className={styles.secondary} onClick={() => void copyKey()}>复制</button>
            <p className={styles.hint}>刷新后会隐藏。有效期至 {new Date(secret.expiresAt).toLocaleString('zh-CN')}。</p>
          </div>}
          <details className={styles.instructions}><summary>MCP 客户端配置</summary>
            <p>在 MCP 客户端使用 stdio 启动此命令，并传入对应环境变量。连接后调用 <code>observe_shared_city</code>。</p>
            <pre>{mcpCommand}</pre>
          </details>
          <details className={styles.instructions}><summary>HTTP API 配置</summary>
            <p>用城市凭据发送观察请求。返回的居民编号应是 {profile.residentId}。</p>
            <pre>{httpCommand}</pre>
          </details>
        </div>}
        {failure && <p className={styles.error} role="alert">{failure}</p>}
        {notice && <p className={styles.notice} role="status">{notice}</p>}
      </section>
    </div>
  </div>;
}
