import fs from 'node:fs/promises'
import { DATA_DIR, driverName, withAdmin, closeDb } from './client.ts'

if (driverName === 'pglite') {
  await fs.rm(DATA_DIR, { recursive: true, force: true })
  console.log(`Dropped local database at ${DATA_DIR}`)
} else {
  await withAdmin(c => c.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'))
  console.log('Dropped and recreated schema "public"')
  await closeDb()
}
