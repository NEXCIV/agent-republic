import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader';

/**
 * Identity Center — the `/identity` landmark route from district-01.ts.
 *
 * This page is protocol documentation: it states the citizenship rules from
 * AGENTS.md §3 and never invents holder counts or on-chain numbers. Wallet
 * verification lives on /my-agent; this page stays read-only.
 */

// Official fixed Agent ID contract (AGENTS.md §3); the env override exists so
// deployments can point at a different manifest if one ever exists.
const AGENT_ID_ADDRESS =
  process.env.NEXT_PUBLIC_AGENT_ID_ADDRESS ?? '0x60b9262456de011f7d15a54cdd8c48baaa8b022f';

export const metadata = { title: 'Identity Center — AGENT REPUBLIC' };

const STEPS = [
  {
    label: '01 / Hold',
    value: 'Agent ID',
    hint: 'Citizenship is proven by holding an official Agent ID on BNB Smart Chain. The runtime check is balanceOf(owner) > 0 — no database flag ever substitutes for it.',
  },
  {
    label: '02 / Register',
    value: '100 BUILD',
    hint: 'Registering as a citizen consumes 100 BUILD. The registerCitizen transaction must be sent by the wallet that actually holds the Agent ID — never by this website.',
  },
  {
    label: '03 / Act',
    value: 'Vote & build',
    hint: 'Registered citizens vote in the Council and contribute BUILD to public works. Rewards accrue per UTC epoch and are only credited after confirmation.',
  },
] as const;

const RULES = [
  { label: 'Registration', value: '100 BUILD', hint: 'Consumed once per citizen at registration.' },
  {
    label: 'First valid vote / UTC epoch',
    value: '+20 BUILD · +2 REP',
    hint: 'Credited only for the first confirmed vote in each UTC epoch.',
  },
  {
    label: 'Contribution REP',
    value: '+1 REP / 10 BUILD',
    hint: 'Capped at 10 REP per owner per UTC epoch. REP is earned, never purchased.',
  },
  {
    label: 'Voting power',
    value: '1 vote',
    hint: 'One Agent ID owner has one vote per proposal. REP never increases voting power.',
  },
] as const;

export default function IdentityPage() {
  return (
    <>
      <PageHeader
        eyebrow="Landmark 02 · District 01 · BNB Smart Chain"
        title={
          <>
            Citizenship by <em>Agent ID</em>
          </>
        }
        lede="The Identity Center is where the republic recognizes its citizens. There are no accounts and no invitations: one official Agent ID on BNB Chain is the entire proof. This page states the fixed rules — it never reads your wallet and never asks for a signature."
        meta={['Chain 56 / Read-only', 'Official Agent ID contract', 'Never holds keys']}
      />

      <section className="section">
        <div className="section-head">
          <span className="section-index">01</span>
          <h2>How citizenship works</h2>
        </div>
        <div className="grid">
          {STEPS.map((step) => (
            <div className="stat" key={step.label}>
              <div className="label">{step.label}</div>
              <div className="value">{step.value}</div>
              <p className="hint" style={{ marginBottom: 0 }}>
                {step.hint}
              </p>
            </div>
          ))}
        </div>
      </section>

      <div className="band-light">
        <section className="section" style={{ marginTop: 0 }}>
          <div className="section-head">
            <span className="section-index">02</span>
            <h2>Fixed economy rules</h2>
          </div>
          <div className="grid">
            {RULES.map((rule) => (
              <div className="stat" key={rule.label}>
                <div className="label">{rule.label}</div>
                <div className="value" style={{ fontSize: 26 }}>
                  {rule.value}
                </div>
                <p className="hint" style={{ marginBottom: 0 }}>
                  {rule.hint}
                </p>
              </div>
            ))}
          </div>
          <p className="hint" style={{ marginTop: 16 }}>
            These parameters are fixed by the protocol plan. BUILD and REP are non-transferable game points, not
            tradable tokens — they cannot be bought, sold or moved between citizens.
          </p>
        </section>
      </div>

      <section className="section">
        <div className="section-head">
          <span className="section-index">03</span>
          <h2>Official contract</h2>
        </div>
        <div className="panel">
          <div className="label" style={{ marginBottom: 10 }}>
            Agent ID · BNB Smart Chain (chain 56)
          </div>
          <p className="mono" style={{ margin: '0 0 12px', wordBreak: 'break-all' }}>
            {AGENT_ID_ADDRESS}
          </p>
          <p style={{ margin: 0 }}>
            <a href={`https://bscscan.com/address/${AGENT_ID_ADDRESS}`} rel="noreferrer noopener" target="_blank">
              Verify on BscScan →
            </a>
          </p>
          <p className="hint" style={{ marginBottom: 0 }}>
            The runtime citizenship check is a direct balanceOf(owner) read against this contract. Verify your own
            Agent ID from the owner console —{' '}
            <Link href="/my-agent" className="hint">
              My Agent
            </Link>
            .
          </p>
        </div>
      </section>
    </>
  );
}
