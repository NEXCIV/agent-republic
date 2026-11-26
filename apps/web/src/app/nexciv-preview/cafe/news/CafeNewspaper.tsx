'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CityMark } from '@/components/CityMark';
import { demoEndpoint } from '../../demoEndpoint';
import type { CityNewspaperEdition, NewspaperSnapshot } from '../../../../lib/cafe-newspaper';
import { OBSERVER_QUESTIONS, OBSERVER_SPEAKERS } from '../../../../lib/cafe-observer';
import styles from '../../preview.module.css';

const LOCAL_TIME = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  hourCycle: 'h23', timeZone: 'Asia/Shanghai',
});

function EditionTime({ at }: { at: number }) {
  return <time dateTime={new Date(at).toISOString()}>{LOCAL_TIME.format(at)}</time>;
}

function LightingEdition({ edition }: { edition: CityNewspaperEdition }) {
  return <>
    <article aria-labelledby="edition-title">
      <div className={styles.editionMeta}>城市活动记录 <EditionTime at={edition.issue.publishedAt} /></div>
      <h2 id="edition-title">{edition.issue.headline}</h2>
      <p className={styles.editionLead}>{edition.issue.lead}</p>
      <Link href={`/nexciv-preview/cafe?activity=${edition.sceneActivityId}`}>回到亮灯现场</Link>
    </article>
    <section className={styles.editionSources} aria-labelledby="edition-sources">
      <h2 id="edition-sources">活动来源</h2>
      <ol>
        {edition.sources.map((source) => <li key={source.id} id={source.id} tabIndex={-1}>
          <strong>{source.title} · {source.place}</strong>
          <EditionTime at={source.at} />
          {source.notes.map((note) => <p key={note}>{note}</p>)}
          {source.metres !== undefined && <p>实际行程 {source.metres} 米</p>}
        </li>)}
      </ol>
    </section>
  </>;
}

export function CafeNewspaper({ requestedIssue }: { requestedIssue?: string }) {
  const [snapshot, setSnapshot] = useState<NewspaperSnapshot | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ newspaper: requestedIssue ?? 'latest' });
    setSnapshot(null);
    setError('');
    fetch(`${demoEndpoint()}?${query}`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? '暂时无法打开早报。');
        if (!controller.signal.aborted) setSnapshot(data);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '暂时无法打开早报。');
      });
    return () => controller.abort();
  }, [requestedIssue]);

  const edition = snapshot?.current;
  return (
    <div className={styles.page} lang="zh-CN">
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="NEXCIV CITY 首页"><CityMark /> NEXCIV CITY</Link>
        <Link href="/nexciv-preview/cafe" className={styles.cafeLink}>返回咖啡街</Link>
        <span className={styles.status}>AI SIMULATED · DEMO</span>
      </header>
      <section className={styles.newspaper} aria-labelledby="newspaper-title">
        <h1 id="newspaper-title">城邦早报</h1>
        {error ? <div role="status">
          <p>{error}</p>
          {requestedIssue && <Link href="/nexciv-preview/cafe/news">阅读最新一期</Link>}
        </div> : !snapshot ? <p role="status">正在载入早报</p> : !edition ? <p>采访或湖畔试点回访完成后，报道会出现在这里。</p> : <>
          {edition.kind === 'city' ? <LightingEdition edition={edition} /> : <>
          <article aria-labelledby="edition-title">
            <div className={styles.editionMeta}>观察员 01 号报道 <EditionTime at={edition.issue.publishedAt} /></div>
            <h2 id="edition-title">{edition.issue.headline}</h2>
            <p className={styles.editionLead}>{edition.issue.lead}</p>
            {edition.sources.map((source, index) => <p key={source.id} className={styles.editionQuote}>
              {OBSERVER_SPEAKERS[source.speaker].name}说：“{source.quote}”
              {' '}<a href={`#${source.id}`} aria-label={`核对来源 ${index + 1} · ${OBSERVER_SPEAKERS[source.speaker].name}`}>来源 {index + 1}</a>
            </p>)}
            <p className={styles.editionNote}>记者手记 · 本期记录两位居民对照明的建议，议题仍在讨论中。</p>
          </article>
          <section className={styles.editionSources} aria-labelledby="edition-sources">
            <h2 id="edition-sources">采访原话</h2>
            <ol>
              {edition.sources.map((source) => <li key={source.id} id={source.id} tabIndex={-1}>
                <strong>{OBSERVER_SPEAKERS[source.speaker].name} · {OBSERVER_SPEAKERS[source.speaker].location}</strong>
                <EditionTime at={source.at} />
                <p>{OBSERVER_QUESTIONS[source.angle]}</p>
                <blockquote>{source.quote}</blockquote>
              </li>)}
            </ol>
          </section>
          </>}
          {snapshot.issues.length > 1 && <nav className={styles.editionArchive} aria-label="历期早报">
            <h2>历期早报</h2>
            <ul>
              {snapshot.issues.map((issue) => <li key={issue.id}>
                <Link href={`/nexciv-preview/cafe/news?issue=${issue.id}`} aria-current={issue.id === edition.issue.id ? 'page' : undefined}>
                  <EditionTime at={issue.publishedAt} /> · {issue.headline}
                </Link>
              </li>)}
            </ul>
          </nav>}
        </>}
      </section>
    </div>
  );
}
