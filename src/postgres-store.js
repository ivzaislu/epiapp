import pg from 'pg';
import { Store, createDefaultState, normalizeState } from './store.js';

const { Pool } = pg;

function safeTableName(value) {
  const name = String(value || 'epiapp_state');
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(name)) {
    throw new Error('Invalid PostgreSQL state table name.');
  }
  return name;
}

export class PostgresStore extends Store {
  constructor(connectionString, { tableName = 'epiapp_state', poolOptions = {} } = {}) {
    if (!String(connectionString || '').trim()) throw new Error('PostgreSQL connection string is required.');
    super(null);
    this.tableName = safeTableName(tableName);
    this.tableSql = `"${this.tableName}"`;
    this.lockKey = `epiapp:${this.tableName}`;
    this.pool = new Pool({
      connectionString: String(connectionString).trim(),
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ...poolOptions,
    });
    this.schemaPromise = null;
  }

  async ensureSchema() {
    if (!this.schemaPromise) {
      this.schemaPromise = this.pool.query(`
        CREATE TABLE IF NOT EXISTS ${this.tableSql} (
          id SMALLINT PRIMARY KEY CHECK (id = 1),
          state JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `).catch((error) => {
        this.schemaPromise = null;
        throw error;
      });
    }
    await this.schemaPromise;
  }

  async read() {
    await this.ensureSchema();
    const result = await this.pool.query(
      `SELECT state FROM ${this.tableSql} WHERE id = 1`,
    );
    if (!result.rows.length) return createDefaultState();
    return normalizeState(result.rows[0].state);
  }

  async write(state) {
    await this.ensureSchema();
    const normalized = normalizeState(state);
    await this.pool.query(
      `INSERT INTO ${this.tableSql} (id, state, updated_at)
       VALUES (1, $1::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE
       SET state = EXCLUDED.state, updated_at = NOW()`,
      [JSON.stringify(normalized)],
    );
  }

  async mutate(operation) {
    await this.ensureSchema();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [this.lockKey]);
      const result = await client.query(
        `SELECT state FROM ${this.tableSql} WHERE id = 1 FOR UPDATE`,
      );
      const state = result.rows.length ? normalizeState(result.rows[0].state) : createDefaultState();
      const value = await operation(state);
      const normalized = normalizeState(state);
      await client.query(
        `INSERT INTO ${this.tableSql} (id, state, updated_at)
         VALUES (1, $1::jsonb, NOW())
         ON CONFLICT (id) DO UPDATE
         SET state = EXCLUDED.state, updated_at = NOW()`,
        [JSON.stringify(normalized)],
      );
      await client.query('COMMIT');
      return value;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async hasState() {
    await this.ensureSchema();
    const result = await this.pool.query(
      `SELECT EXISTS(SELECT 1 FROM ${this.tableSql} WHERE id = 1) AS present`,
    );
    return Boolean(result.rows[0]?.present);
  }

  async importState(state, { overwrite = false } = {}) {
    await this.ensureSchema();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [this.lockKey]);
      const existing = await client.query(
        `SELECT 1 FROM ${this.tableSql} WHERE id = 1 FOR UPDATE`,
      );
      if (existing.rows.length && !overwrite) {
        throw new Error('PostgreSQL store already contains EpiApp data. Use --force only after making a backup.');
      }
      const normalized = normalizeState(state);
      await client.query(
        `INSERT INTO ${this.tableSql} (id, state, updated_at)
         VALUES (1, $1::jsonb, NOW())
         ON CONFLICT (id) DO UPDATE
         SET state = EXCLUDED.state, updated_at = NOW()`,
        [JSON.stringify(normalized)],
      );
      await client.query('COMMIT');
      return normalized;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async close() {
    await this.pool.end();
  }
}
