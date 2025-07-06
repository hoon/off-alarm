import { beforeAll, expect, test, describe } from 'bun:test'
import { InfluxDB } from '@influxdata/influxdb-client'
import { Database } from 'bun:sqlite'
import {
  getDevicePowerReadings,
  getDevicePowerStats,
  initSqliteTables,
} from '../src/index'

let influxDb: InfluxDB
let db: Database

beforeAll(async () => {
  console.log(`process.env.INFLUX_URL: ${process.env.INFLUX_URL}`)
  console.log(`process.env.INFLUX_TOKEN: ${process.env.INFLUX_TOKEN}`)
  console.log(
    `process.env.INFLUX_DEVICE_POWER_BUCKET: ${process.env.INFLUX_DEVICE_POWER_BUCKET}`,
  )
  console.log(
    `process.env.INFLUX_DEVICE_POWER_MEASUREMENT: ${process.env.INFLUX_DEVICE_POWER_MEASUREMENT}`,
  )
  influxDb = new InfluxDB({
    url: process.env.INFLUX_URL!,
    token: process.env.INFLUX_TOKEN,
  })
  db = await Database.open(':memory:')

  await initSqliteTables(db)
  await getDevicePowerReadings(influxDb, db)
})

describe('getDevicePowerStats', () => {
  test('are data rows in database', async () => {
    const rows = db.prepare(`SELECT * FROM device_power`).all()
    console.log(rows)
    expect(rows.length).toBeGreaterThan(0)
  })
  test('able to get something back', async () => {
    const stats = await getDevicePowerStats(db, {
      forSec: 300,
      untilTime: Date.now(),
    })
    console.log(stats)
    expect(stats).toBeDefined()
  })

  test('steady state with >20W power use', async () => {
    const untilTime = new Date('2025-06-08 03:10:00 EDT').getTime()
    await getDevicePowerReadings(influxDb, db, {
      forSec: 300,
      untilTime,
    })
    const stats = await getDevicePowerStats(db, {
      forSec: 300,
      untilTime,
    })
    console.log(stats)
    expect(stats).toBeDefined()
  })

  test('transition from active >20W to stand-by', async () => {
    const untilTime = new Date('2025-06-08 08:19:00 EDT').getTime()
    await getDevicePowerReadings(influxDb, db, {
      forSec: 300,
      untilTime,
    })
    const stats = await getDevicePowerStats(db, {
      forSec: 300,
      untilTime,
    })
    console.log(stats)
    expect(stats).toBeDefined()
  })

  test('transition from stand-by to active >20W', async () => {
    const untilTime = new Date('2025-06-08 01:18:00 EDT').getTime()
    await getDevicePowerReadings(influxDb, db, {
      forSec: 300,
      untilTime,
    })
    const stats = await getDevicePowerStats(db, {
      forSec: 300,
      untilTime,
    })
    console.log(stats)
    expect(stats).toBeDefined()
  })

  test('transition from stand-by (3W) to sleep (2W)', async () => {
    const untilTime = new Date('2025-06-08 08:49:00 EDT').getTime()
    await getDevicePowerReadings(influxDb, db, {
      forSec: 300,
      untilTime,
    })
    const stats = await getDevicePowerStats(db, {
      forSec: 300,
      untilTime,
    })
    console.log(stats)
    expect(stats).toBeDefined()
  })

  test('steady state active low power (~4W)', async () => {
    const untilTime = new Date('2025-06-24 02:16:00 EDT').getTime()
    await getDevicePowerReadings(influxDb, db, {
      forSec: 300,
      untilTime,
    })
    const stats = await getDevicePowerStats(db, {
      forSec: 300,
      untilTime,
    })
    console.log(stats)
    expect(stats).toBeDefined()
  })

  test('transition from standby (~3W) to sleep (2W) with a spike', async () => {
    const untilTime = new Date('2025-06-28 07:37:00 EDT').getTime()
    await getDevicePowerReadings(influxDb, db, {
      forSec: 300,
      untilTime,
    })
    const stats = await getDevicePowerStats(db, {
      forSec: 300,
      untilTime,
    })
    console.log(stats)
    expect(stats).toBeDefined()
  })

  test('sleep (~2W) state with a small blip up', async () => {
    const untilTime = new Date('2025-06-28 07:43:00 EDT').getTime()
    await getDevicePowerReadings(influxDb, db, {
      forSec: 300,
      untilTime,
    })
    const stats = await getDevicePowerStats(db, {
      forSec: 300,
      untilTime,
    })
    console.log(stats)
    expect(stats).toBeDefined()
  })

  test('active (~7W) steady state', async () => {
    const untilTime = new Date('2025-06-29 08:01:00 EDT').getTime()
    await getDevicePowerReadings(influxDb, db, {
      forSec: 300,
      untilTime,
    })
    const stats = await getDevicePowerStats(db, {
      forSec: 300,
      untilTime,
    })
    console.log(stats)
    expect(stats).toBeDefined()
  })

  test('active (~7W) steady state', async () => {
    const untilTime = new Date('2025-06-29 03:04:00 EDT').getTime()
    await getDevicePowerReadings(influxDb, db, {
      forSec: 300,
      untilTime,
    })
    const stats = await getDevicePowerStats(db, {
      forSec: 300,
      untilTime,
    })
    console.log(stats)
    expect(stats).toBeDefined()
  })
})
