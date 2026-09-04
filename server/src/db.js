import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let pool = null;

export async function initDb() {
  if (!process.env.DATABASE_URL) {
    console.warn('DATABASE_URL is not set. Database features will be disabled.');
    return null;
  }

  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Add SSL for managed databases like Render/Supabase if required,
    // we'll keep it relaxed to support dev/prod differences.
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    const client = await pool.connect();
    console.log('Connected to PostgreSQL');
    
    // Initialize schema
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    
    await client.query(schemaSql);
    console.log('Database schema initialized');
    
    client.release();
    return pool;
  } catch (err) {
    console.error('Failed to initialize database:', err);
    // Don't crash immediately, allow app to limp along or retry
    return null;
  }
}

export function getDb() {
  return pool;
}

export async function query(text, params) {
  if (!pool) return null;
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    // console.log('executed query', { text, duration, rows: res.rowCount });
    return res;
  } catch (err) {
    console.error('Error executing query', { text, err });
    throw err;
  }
}
