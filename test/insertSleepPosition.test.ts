import { _TESTING } from '../src'
import { Database } from 'bun:sqlite'
import { test, expect, beforeAll } from 'bun:test'

const { insertSleepPosition, initSleepPositionTables } = _TESTING!

const _db = new Database(':memory:')

beforeAll(async () => {
  await initSleepPositionTables(_db)
})

test('test insertSleepPosition', async () => {
  const dataStr =
    `{"position": "Empty", "position_confidence": 0.9999738931655884, ` +
    `"sleep_status": "Awake", "sleep_status_confidence": 0.9999384880065918, ` +
    `"mask_status": "Mask off", "mask_status_confidence": 0.9999972581863403, ` +
    `"timestamp": 1787757149}`

  await insertSleepPosition(_db, dataStr)

  const countQuery = _db.query(
    'SELECT COUNT(*) as row_count FROM sleep_position WHERE stime_sec = 1787757149;',
  )

  const result = countQuery.get()

  expect(result).toHaveProperty('row_count')
  expect((result as { row_count: number }).row_count).toEqual(1)
})
