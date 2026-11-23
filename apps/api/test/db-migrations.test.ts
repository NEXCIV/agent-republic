import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * E2-01 DoD: applying db/migrations/*.sql in filename order to an empty
 * database must rebuild the full schema. No local Postgres is available in
 * this environment, so these tests statically validate the migration files:
 * table set, foreign-key closure, statement hygiene, and the spec-mandated
 * uniqueness / reorg constraints from docs/ARCHITECTURE.md §6 and
 * docs/WORLD_ENGINE.md §7.
 */

const MIGRATIONS_DIR = fileURLToPath(
  new URL('../../../db/migrations', import.meta.url),
);

const migrationFiles = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith('.sql'))
  .sort();

const fileContents = new Map(
  migrationFiles.map((name) => [
    name,
    readFileSync(`${MIGRATIONS_DIR}/${name}`, 'utf8'),
  ] as const),
);

/** SQL with `--` comment lines removed. */
function stripComments(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
}

/** Top-level statements (no semicolons appear inside our DDL bodies). */
function statements(sql: string): string[] {
  return stripComments(sql)
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

function createTableNames(sql: string): string[] {
  return [...stripComments(sql).matchAll(/CREATE TABLE ([a-z0-9_]+)/g)].map(
    (match) => match[1]!,
  );
}

/** Body of `CREATE TABLE <name> ( ... )` for per-table constraint checks. */
function tableBody(sql: string, name: string): string {
  const match = stripComments(sql).match(
    new RegExp(`CREATE TABLE ${name} \\(([\\s\\S]*?)\\n\\);`),
  );
  return match?.[1] ?? '';
}

const EXPECTED_TABLES = [
  'schema_migrations',
  'app_users',
  'auth_challenges',
  'identity_bindings',
  'agents',
  'agent_configs',
  'agent_commands',
  'agent_command_locations',
  'epochs',
  'proposals',
  'projects',
  'agent_messages',
  'action_intents',
  'action_approvals',
  'chain_events',
  'chain_block_hashes',
  'chain_sync_cursors',
  'agent_memories',
  'llm_usage',
  'audit_logs',
  // world extension tables (WORLD_ENGINE.md §7)
  'world_scene_versions',
  'social_revisions',
  'world_ticks',
  'world_sim_states',
  'world_visual_events',
] as const;

describe('db/migrations files', () => {
  it('contains ordered NNNN_name.sql files', () => {
    expect(migrationFiles.length).toBeGreaterThan(0);
    for (const name of migrationFiles) {
      expect(name).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
    }
    expect(migrationFiles).toEqual([...migrationFiles].sort());
  });

  it('wraps every file in a single BEGIN/COMMIT transaction', () => {
    for (const [name, sql] of fileContents) {
      const stmts = statements(sql);
      expect(stmts[0], `${name} must start with BEGIN`).toBe('BEGIN');
      expect(stmts.at(-1), `${name} must end with COMMIT`).toBe('COMMIT');
    }
  });

  it('only contains known DDL statement types', () => {
    const allowed =
      /^(BEGIN|COMMIT|CREATE (TABLE|(?:UNIQUE )?INDEX|DOMAIN|TYPE|VIEW|EXTENSION)|ALTER TABLE)/;
    for (const [name, sql] of fileContents) {
      for (const statement of statements(sql)) {
        expect(
          allowed.test(statement.replace(/\s+/g, ' ')),
          `${name}: unexpected statement "${statement.slice(0, 60)}..."`,
        ).toBe(true);
      }
    }
  });
});

describe('E2-01 schema coverage (ARCHITECTURE §6 + WORLD_ENGINE §7)', () => {
  const allSql = [...fileContents.values()].join('\n');
  const tables = createTableNames(allSql);

  it('creates exactly the expected tables, with no duplicates', () => {
    expect(new Set(tables).size).toBe(tables.length);
    expect([...new Set(tables)].sort()).toEqual([...EXPECTED_TABLES].sort());
  });

  it('creates the shared domains (lowercase address / hash enforcement)', () => {
    const domains = [...stripComments(allSql).matchAll(/CREATE DOMAIN ([a-z0-9_]+)/g)].map(
      (match) => match[1]!,
    );
    expect(domains).toContain('evm_address');
    expect(domains).toContain('hex_hash66');
    expect(domains).toContain('build_amount');
    expect(stripComments(allSql)).toMatch(
      /evm_address AS TEXT\s+CHECK \(VALUE ~ '\^0x\[0-9a-f\]\{40\}\$'\)/,
    );
  });

  it('resolves every foreign key to a table created earlier (or in a prior file)', () => {
    const createdSoFar = new Set<string>();
    for (const [name, sql] of fileContents) {
      const order = createTableNames(sql);
      for (const match of stripComments(sql).matchAll(/REFERENCES ([a-z0-9_]+)/g)) {
        const target = match[1]!;
        expect(
          createdSoFar.has(target) || order.indexOf(target) >= 0,
          `${name}: FK target ${target} is never created`,
        ).toBe(true);
      }
      for (const table of order) createdSoFar.add(table);
    }
  });
});

describe('spec-mandated constraints', () => {
  const sql = [...fileContents.values()].join('\n');

  it('chain_events: unique (chain_id, tx_hash, log_index), block_hash, ORPHANED reorg state', () => {
    const body = tableBody(sql, 'chain_events');
    expect(body).toMatch(/UNIQUE \(chain_id, tx_hash, log_index\)/);
    expect(body).toMatch(/block_hash hex_hash66 NOT NULL/);
    expect(body).toMatch(/CHECK \(status IN \('INCLUDED', 'ORPHANED'\)\)/);
    expect(body).toMatch(/owner evm_address/);
  });

  it('chain_sync_cursors: unique (chain_id, contract)', () => {
    expect(tableBody(sql, 'chain_sync_cursors')).toMatch(
      /UNIQUE \(chain_id, contract\)/,
    );
  });

  it('identity: one binding per owner and per app_user', () => {
    const body = tableBody(sql, 'identity_bindings');
    expect(body).toMatch(/owner evm_address PRIMARY KEY/);
    expect(body).toMatch(/app_user_id UUID NOT NULL UNIQUE/);
    expect(tableBody(sql, 'agents')).toMatch(/owner evm_address NOT NULL UNIQUE/);
    expect(tableBody(sql, 'auth_challenges')).toMatch(
      /commitment hex_hash66 NOT NULL UNIQUE/,
    );
  });

  it('intents: idempotency_key unique, action_type restricted to the domain intent set', () => {
    const body = tableBody(sql, 'action_intents');
    expect(body).toMatch(/idempotency_key TEXT NOT NULL UNIQUE/);
    expect(body).toMatch(/action_type TEXT NOT NULL CHECK \(action_type IN \('OBSERVE'/);
  });

  it('llm_usage: request_id unique', () => {
    expect(tableBody(sql, 'llm_usage')).toMatch(/request_id TEXT NOT NULL UNIQUE/);
  });

  it('projects: funded_build never exceeds goal_build; states match the contract', () => {
    const body = tableBody(sql, 'projects');
    expect(body).toMatch(/CHECK \(funded_build <= goal_build\)/);
    expect(body).toMatch(/CHECK \(state IN \('FUNDING', 'COMPLETED'\)\)/);
    expect(body).toMatch(/goal_build build_amount NOT NULL/);
  });

  it('epochs: end_at after start_at', () => {
    expect(tableBody(sql, 'epochs')).toMatch(/CHECK \(end_at > start_at\)/);
  });

  it('world tables: tick uniqueness, sim-state FK, and origin trust labels', () => {
    expect(tableBody(sql, 'world_ticks')).toMatch(
      /UNIQUE \(scene_version, tick\)/,
    );
    expect(tableBody(sql, 'world_visual_events')).toMatch(
      /UNIQUE \(scene_version, tick, source_id, kind\)/,
    );
    expect(tableBody(sql, 'world_visual_events')).toMatch(
      /CHECK \(origin IN \('CHAIN_CONFIRMED', 'OFFCHAIN_APPROVED', 'SYSTEM_SIMULATED'\)\)/,
    );
    expect(tableBody(sql, 'world_sim_states')).toMatch(
      /FOREIGN KEY \(scene_version, tick\) REFERENCES world_ticks/,
    );
  });
});
