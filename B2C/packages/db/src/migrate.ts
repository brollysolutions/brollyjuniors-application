import fs from 'node:fs/promises'
import path from 'node:path'
import { withAdmin, DB_ROOT, DATA_DIR, driverName, closeDb } from './client.ts'

const SQL_DIR = path.join(DB_ROOT, 'sql')

async function main() {
  const files = (await fs.readdir(SQL_DIR)).filter(f => f.endsWith('.sql')).sort()
  await withAdmin(async c => {
    await c.exec(`CREATE TABLE IF NOT EXISTS schema_migration (
      filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());`)
    const done = new Set((await c.query<{ filename: string }>(
      'SELECT filename FROM schema_migration')).map(r => r.filename))
    for (const file of files) {
      if (done.has(file)) { console.log(`  = ${file}`); continue }
      const sql = await fs.readFile(path.join(SQL_DIR, file), 'utf8')
      process.stdout.write(`  + ${file} ... `)
      await c.exec(sql)
      await c.query('INSERT INTO schema_migration (filename) VALUES ($1)', [file])
      console.log('ok')
    }
  })
  console.log(`\nSchema up to date  ·  driver=${driverName}${driverName === 'pglite' ? `  ·  ${DATA_DIR}` : ''}`)
  await closeDb()
}
main().catch(err => { console.error('\nMigration failed:\n', err); process.exit(1) })
