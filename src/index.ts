import { InfluxDB } from '@influxdata/influxdb-client'
import { flux } from '@influxdata/influxdb-client'
import { Database } from 'bun:sqlite'
import mqtt from 'mqtt'
import { z } from 'zod'
import pino from 'pino'
import { getVariancePop } from './statutils'
const logger = pino({ level: process.env.LOG_LEVEL || 'info' })

async function getInfluxDb() {
  try {
    const influxdb = new InfluxDB({
      url: process.env.INFLUX_URL!,
      token: process.env.INFLUX_TOKEN!,
    })

    return influxdb
  } catch (err) {
    logger.error(`InfluxDB connection failed: ${err}`)
    throw err
  }
}

const db = process.env.PERSIST_SENSOR_DATA
  ? new Database('sensor.sqlite', { create: true })
  : new Database(':memory:')
const edb = new Database('button_event.sqlite', { create: true })

const buttonEvent = z.object({
  etime: z.number(), // millisecond unix timestamp
  event_type: z.number(),
  temp_c: z.number().nullable(),
  illuminance_lux: z.number().nullable(),
})

enum ButtonEventType {
  InBed = 10,
  Awake = 20,
  UpFromBed = 30,
}

const DEVICE_POWER_ON_THRESHOLD_WATT: number = Number.parseFloat(
  process.env.DEVICE_POWER_ON_THRESHOLD_WATT || '4',
)

const DEVICE_POWER_VARIANCE_POP_THRESHOLD: number = Number.parseFloat(
  process.env.DEVICE_POWER_VARIANCE_POP_THRESHOLD || '3',
)

const ILLUMINANCE_DARK_THRESHOLD_LUX: number = Number.parseFloat(
  process.env.ILLUMINANCE_DARK_THRESHOLD_LUX || '17',
)

function getFluxTimeRangeStr({
  forSec,
  untilTime,
}: {
  forSec: number
  untilTime: number
}) {
  return untilTime === -1
    ? flux`range(start: -${forSec}s)`
    : flux`range(
        start: time(v: ${new Date(untilTime - forSec * 1000).toISOString()}),
        stop: time(v: ${new Date(untilTime).toISOString()})
      )`
}

export async function getDevicePowerReadings(
  _influxDb: InfluxDB,
  _db: Database,
  {
    forSec = 300,
    untilTime = -1,
  }: { forSec?: number; untilTime?: number } = {},
) {
  const queryApi = _influxDb.getQueryApi(process.env.INFLUX_ORG!)
  const timeRangeStr = getFluxTimeRangeStr({ forSec, untilTime })
  const fluxQuery = flux`
    import "math"
    from(bucket:${process.env.INFLUX_DEVICE_POWER_BUCKET})
      |> ${timeRangeStr}
      |> filter(fn: (r) => r._measurement == "${process.env.INFLUX_DEVICE_POWER_MEASUREMENT}")
      |> map(fn: (r) => ({_time: r._time, _value: r._value, unix_time: uint(v: r._time) / uint(v: 1000000)}))
  `

  const powerWattReadings: { time: number; powerWatt: number }[] = []

  return await new Promise((resolve, reject) => {
    queryApi.queryRows(fluxQuery, {
      next(row, tableMeta) {
        const o = tableMeta.toObject(row)

        // console.log(o)
        // console.log(row)
        // console.log('')
        const time = Date.parse(o._time)
        const powerWatt = o._value
        if (powerWatt == undefined || powerWatt == null) {
          return
        }
        powerWattReadings.push({ time, powerWatt })

        const stmt = _db.prepare(
          `INSERT INTO device_power (mtime, power_watt) ` +
            `VALUES ($mtime, $powerWatt);`,
        )

        try {
          stmt.run({ $mtime: time, $powerWatt: powerWatt })
        } catch (err) {
          logger.warn(
            `getDevicePowerReadings(): device_power table insert error: ${err}, values ${JSON.stringify(
              {
                $mtime: time,
                $powerWatt: powerWatt,
              },
            )}`,
          )
        }
      },
      error: reject,
      complete() {
        resolve(powerWattReadings)
      },
    })
  })
}

export async function getIlluminanceReadings(
  _influxDb: InfluxDB,
  _db: Database,
  {
    forSec = 300,
    untilTime = -1,
  }: { forSec?: number; untilTime?: number } = {},
) {
  const queryApi = _influxDb.getQueryApi(process.env.INFLUX_ORG!)
  const timeRangeStr = getFluxTimeRangeStr({ forSec, untilTime })
  const fluxQuery = flux`
    import "math"
    from(bucket:"${process.env.INFLUX_ENV_READINGS_BUCKET!}")
      |> ${timeRangeStr}
      |> filter(fn: (r) => r._measurement == "${process.env.INFLUX_ENV_READINGS_MEASUREMENT}")
      |> filter(fn: (r) => r._field == "illuminance_lux" or r._field == "temp_c")
      |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
      |> map(fn: (r) => ({r with unix_time: uint(v: r._time) / uint(v: 1000000)}))
  `

  const illuminanceReadings: {
    time: number
    illuminanceLux: number
    tempC: number
  }[] = []
  return await new Promise((resolve, reject) => {
    queryApi.queryRows(fluxQuery, {
      next(row, tableMeta) {
        const o = tableMeta.toObject(row)
        const illuminanceLux = o.illuminance_lux
        if (illuminanceLux == undefined || illuminanceLux == null) {
          return
        }
        const tempC = o.temp_c
        illuminanceReadings.push({
          time: o.unix_time,
          illuminanceLux,
          tempC,
        })

        const stmt = _db.prepare(
          `INSERT INTO illuminance (mtime, illuminance_lux, temp_c) ` +
            `VALUES ($mtime, $illuminanceLux, $tempC);`,
        )

        try {
          logger.debug(
            `getIlluminanceReadings(): inserting {${o._time}, ${illuminanceLux}}}`,
          )
          stmt.run({
            $mtime: o.unix_time,
            $illuminanceLux: illuminanceLux,
            $tempC: tempC,
          })
        } catch (err) {
          logger.warn(
            `getIlluminanceReadings(): database illuminance insert error: ${err}`,
          )
        }
      },
      error: reject,
      complete() {
        resolve(illuminanceReadings)
      },
    })
  })
}

export async function initSqliteTables(_db: Database) {
  try {
    const cpr = _db.run(
      `CREATE TABLE IF NOT EXISTS device_power
      (
        mtime INTEGER,
        power_watt INTEGER,
        PRIMARY KEY (mtime)
      );`,
    )
    logger.info(
      `initSqliteTables(): CREATE TABLE device_power: ${JSON.stringify(cpr)}`,
    )
  } catch (err) {
    logger.warn(`initSqliteTables(): device_power table create error: ${err}`)
  }

  try {
    const cilr = _db.run(
      `CREATE TABLE IF NOT EXISTS illuminance
      (
        mtime INTEGER,
        illuminance_lux REAL,
        temp_c REAL,
        PRIMARY KEY (mtime)
      );`,
    )
    logger.info(
      `initSqliteTables(): CREATE TABLE illuminance: ${JSON.stringify(cilr)}`,
    )
  } catch (err) {
    logger.warn(`initSqliteTables(): illuminance table create error: ${err}`)
  }
}

// TODO: make it accept refTime to allow for testing on example data set
async function hasDeviceBeenOff(_db: Database, forSec: number = 300) {
  const countOffVsAllSql = `
    WITH
      off_m AS (
        SELECT COUNT(*) AS num_device_off
          FROM device_power
          WHERE mtime >= $unixTimeMs - $forMs
          AND mtime <= $unixTimeMs
          AND power_watt < $devicePowerOnThresholdWatt
      ),
      all_m AS (
        SELECT COUNT(*) AS num_all
          FROM device_power
          WHERE mtime >= $unixTimeMs - $forMs
          AND mtime <= $unixTimeMs
      ),
      avg_m AS (
        SELECT AVG(power_watt) AS avg_power_watt
          FROM device_power
          WHERE mtime >= $unixTimeMs - $forMs
          AND mtime <= $unixTimeMs
      ),
      last_m AS (
        SELECT power_watt AS last_m_power_watt
          FROM device_power
          ORDER BY mtime DESC
          LIMIT 1
      )
    SELECT
        off_m.num_device_off,
        all_m.num_all,
        off_m.num_device_off / all_m.num_all AS off_ratio,
        avg_m.avg_power_watt,
        last_m.last_m_power_watt
      FROM off_m, all_m, avg_m, last_m
  ;`

  const unixTimeMs = Date.now()
  const stmt = _db.prepare(countOffVsAllSql)
  try {
    const rows = stmt.all({
      $unixTimeMs: unixTimeMs,
      $forMs: forSec * 1000,
      $devicePowerOnThresholdWatt: DEVICE_POWER_ON_THRESHOLD_WATT,
    })

    if (rows && rows[0]) {
      const _r = rows[0] as any
      return {
        numDeviceOff: Number.parseInt(_r.num_device_off!),
        numAll: Number.parseInt(_r.num_all!),
        offRatio: Number.parseFloat(_r.off_ratio!),
        averagePowerWatt: Number.parseFloat(_r.avg_power_watt!),
        lastMeasuredPowerWatt: Number.parseInt(_r.last_m_power_watt!),
      }
    }
  } catch (err) {
    logger.error(
      `hasDeviceBeenOff(): error while retrieving from database: ${err}`,
    )
  }
  return null
}

export async function getDevicePowerStats(
  _db: Database,
  {
    forSec = 300,
    untilTime = -1,
  }: { forSec?: number; untilTime?: number } = {},
) {
  const mtime = Math.floor(untilTime === -1 ? Date.now() : untilTime)
  // SQLite doesn't support var_pop()
  const stmt = _db.prepare(
    `WITH 
      agg_m AS (
        SELECT
          avg(power_watt) AS power_watt_avg,
          max(power_watt) AS power_watt_max,
          min(power_watt) AS power_watt_min,
          count(*) AS num_readings
        FROM device_power
        WHERE mtime >= $mtime - $forMs
        AND mtime <= $mtime
      )
    SELECT
      power_watt_avg, power_watt_max, power_watt_min, num_readings
      FROM agg_m;`,
  )

  interface DevicePowerStats {
    powerWattAvg: number
    powerWattMax: number
    powerWattMin: number
    numReadings: number
    powerWattVarPop: number
  }

  const stats: Partial<DevicePowerStats> = {
    powerWattAvg: undefined,
    powerWattMax: undefined,
    powerWattMin: undefined,
    numReadings: undefined,
    powerWattVarPop: undefined,
  }

  try {
    const rows = stmt.all({ $mtime: mtime, $forMs: forSec * 1000 })
    if (rows && rows[0]) {
      const _r = rows[0] as any
      stats.powerWattAvg = Number.parseFloat(_r.power_watt_avg!)
      stats.powerWattMax = Number.parseFloat(_r.power_watt_max!)
      stats.powerWattMin = Number.parseFloat(_r.power_watt_min!)
      stats.numReadings = Number.parseInt(_r.num_readings!)
    }
  } catch (err) {
    logger.error(
      `getDevicePowerStats(): error while retrieving from database: ${err}`,
    )
    return null
  }

  const allValuesStmt = _db.prepare(
    `SELECT power_watt
      FROM device_power
      WHERE mtime >= $mtime - $forMs
      AND mtime <= $mtime;`,
  )
  try {
    const allValues = allValuesStmt.all({
      $mtime: mtime,
      $forMs: forSec * 1000,
    })

    if (allValues && allValues.length > 0) {
      const allValuesNums = allValues.map((v: any) => v.power_watt as number)
      const variancePop = getVariancePop(allValuesNums)
      stats.powerWattVarPop = variancePop
    }
  } catch (err) {
    logger.error(
      `getDevicePowerStats(): error while retrieving from database: ${err}`,
    )
    return null
  }

  for (const [_, value] of Object.entries(stats)) {
    if (value === undefined) {
      return null
    }
  }
  return stats as DevicePowerStats
}

/*
 * hasItBeenDark() retrieves illuminance values from a time period and
 * calculates the ratio of measurements where the measured illuminance
 * indicates it was dark vs ones that indicate it was bright.
 *
 * Being dark is defined as below $ILLUMINANCE_DARK_THRESHOLD_LUX lux,
 * which is 17 by default.
 *
 * Arguments:
 *  forSec: number of seconds in the time period to retrieve
 *  refTime: the end of the time period to retrieve
 *
 * For example, if forSec is 600 and refTime is 1722528237571, hasItBeenDark()
 * will retrieve measurements between UNIX times (1722528237571 - 600) and
 * 1722528237571 to calculate the dark/(all measurements) ratio.
 *
 * Returns:
 *  numDark: number of measuremens where it was dark
 *  numAll: number of all measurements in the indicated time period
 *  darkRatio: numDark / numAll
 *  lastIlluminanceLux: the last illuminance measurement value in the time period
 */
async function hasItBeenDark(
  _db: Database,
  {
    forSec = 300,
    refTime = -1,
  }: {
    forSec?: number
    refTime?: number
  } = {},
) {
  const countDarkVsAllSql = `
    WITH
      off_m AS (
        SELECT COUNT(*) AS num_dark
          FROM illuminance
          WHERE mtime >= $mtime - $forMs
          AND mtime <= $mtime
          AND illuminance_lux < $illuminanceDarkThresholdLux
      ),
      all_m AS (
        SELECT COUNT(*) AS num_all
          FROM illuminance
          WHERE mtime >= $mtime - $forMs
          AND mtime <= $mtime
      ),
      last_m AS (
        SELECT illuminance_lux AS last_m_illuminance_lux
          FROM illuminance
          ORDER BY mtime DESC
          LIMIT 1
      )
    SELECT
        off_m.num_dark,
        all_m.num_all,
        CAST(off_m.num_dark AS REAL) / all_m.num_all AS dark_ratio,
        last_m.last_m_illuminance_lux
      FROM off_m, all_m, last_m
    ;`

  const mtime = Math.floor(refTime === -1 ? Date.now() : refTime)
  logger.info(
    `hasItBeenDark(): mtime = ${mtime}, forSec = ${forSec}, refTime = ${refTime}`,
  )
  const stmt = _db.prepare(countDarkVsAllSql)
  try {
    const rows = stmt.all({
      $mtime: mtime,
      $forMs: forSec * 1000,
      $illuminanceDarkThresholdLux: ILLUMINANCE_DARK_THRESHOLD_LUX,
    })

    if (rows && rows[0]) {
      const _r = rows[0] as any
      logger.debug(`hasItBeenDark(): query raw result: ${JSON.stringify(_r)}`)
      return {
        numDark: parseInt(_r.num_dark),
        numAll: parseInt(_r.num_all),
        darkRatio: !Number.isNaN(_r.dark_ratio)
          ? parseFloat(_r.dark_ratio)
          : null,
        lastIlluminanceLux: parseFloat(_r.last_m_illuminance_lux),
      }
    }
  } catch (err) {
    logger.error(
      `hasItBeenDark(): error while retrieving from database: ${err}`,
    )
  }
  return null
}

async function getAllIlluminance(_db: Database) {
  const illuminanceSql = `
    SELECT mtime, illuminance_lux
      FROM illuminance
      ORDER BY mtime DESC
      LIMIT 10;
  `
  try {
    const stmt = _db.prepare(illuminanceSql)
    const rows = stmt.all()
    logger.info(`getAllIlluminance(): ${JSON.stringify(rows)}`)
  } catch (err) {
    logger.error(`getAllIlluminance(): error retrievign from database: ${err}`)
  }
}

async function playToneOnDevice(mqttClient: mqtt.MqttClient, tone = 1) {
  return mqttClient.publishAsync(
    process.env.MQTT_TOPIC_BUTTONS_COMMAND!,
    `n=playTone;p=${tone}`,
  )
}

async function flushOldMeasurements(
  _db: Database,
  {
    refTime = -1,
    toKeepSec = 300,
  }: { refTime?: number; toKeepSec?: number } = {},
) {
  const stmt = _db.prepare(`
    DELETE
      FROM device_power
      WHERE mtime < ($mtime - $toKeepMs)
      ;
    DELETE
      FROM illuminance
      WHERE mtime < ($mtime - $toKeepMs)
    ;
  `)

  const time = refTime === -1 ? Date.now() : refTime
  try {
    const rows = stmt.run({
      $mtime: time,
      $toKeepMs: toKeepSec * 1000,
    })
    logger.info(`flushOldMeasurements(): ${JSON.stringify(rows)}`)
  } catch (err) {
    logger.warn(
      `flushOldMeasurements(): Error occurred while attempting to delete old measurements: ${err}`,
    )
  }
}

async function insertDevicePowerReading(
  _db: Database,
  devicePowerReadingStr: string,
) {
  const readObj = JSON.parse(devicePowerReadingStr)

  const devicePowerSensorReadingSchema = z.object({
    StatusSNS: z.object({
      Time: z.string(),
      ENERGY: z.object({
        TotalStartTime: z.string(),
        Total: z.number(),
        Yesterday: z.number(),
        Today: z.number(),
        Power: z.number(),
        ApparentPower: z.number(),
        ReactivePower: z.number(),
        Factor: z.number(),
        Voltage: z.number(),
        Current: z.number(),
      }),
    }),
  })

  const k = await devicePowerSensorReadingSchema.safeParseAsync(readObj)

  if (k.error) {
    logger.warn(
      `insertDevicePowerReading(): failed to parse the power reading string ${devicePowerReadingStr}; ` +
        `error message: ${k.error}`,
    )
    return
  }

  const stmt = _db.prepare(
    `INSERT INTO device_power (mtime, power_watt) ` +
      `VALUES ($mtime, $powerWatt);`,
  )

  const toInsert = {
    $mtime: Date.now(),
    $powerWatt: k.data.StatusSNS.ENERGY.Power,
  }
  try {
    const rows = stmt.run(toInsert)
    logger.info(
      `insertDevicePowerReading(): ${JSON.stringify(rows)}, ${JSON.stringify(toInsert)}`,
    )
  } catch (err) {
    logger.warn(
      `insertDevicePowerReading: device_power table insert error: ${err}, values ${JSON.stringify(
        toInsert,
      )}`,
    )
  }
}

async function insertIlluminanceSensorsReading(
  _db: Database,
  envSensorsReadingStr: string,
) {
  const readObj = JSON.parse(envSensorsReadingStr)

  const envSensorsReadingSchema = z.object({
    StatusSNS: z.object({
      Time: z.string(),
      BME280: z.object({
        Temperature: z.number(),
        Humidity: z.number(),
        DewPoint: z.number(),
        Pressure: z.number(),
      }),
      TSL2561: z.object({
        Illuminance: z.number(),
        IR: z.number(),
        Broadband: z.number(),
      }),
      PressureUnit: z.string(),
      TempUnit: z.string(),
    }),
  })

  const k = await envSensorsReadingSchema.safeParseAsync(readObj)

  if (k.error) {
    logger.warn(
      `insertIlluminanceSensorsReading(): Env sensors reading string parse failed: ${envSensorsReadingStr}; ` +
        `error msg: ${k.error}`,
    )
    return
  }

  // we only care about the illuminance from the sensor readings
  const stmt = _db.prepare(
    `INSERT INTO illuminance (mtime, illuminance_lux, temp_c) ` +
      `VALUES ($mtime, $illuminanceLux, $tempC);`,
  )

  try {
    const toInsert = {
      // k.data.StatusSNS.Time is in Amsterdam time because that's where Tasmota binary was compiled
      $mtime: Date.now(),
      $illuminanceLux: k.data.StatusSNS.TSL2561.Illuminance,
      $tempC: k.data.StatusSNS.BME280.Temperature,
    }
    const insertResult = stmt.run(toInsert)
    logger.info(
      `insertIlluminanceSensorsReading(): ${JSON.stringify(insertResult)}, ${JSON.stringify(toInsert)}`,
    )
  } catch (err) {
    logger.warn(
      `insertIlluminanceSensorsReading(): illuminance reading database insert error: ${err}`,
    )
  }
}

async function initButtonEventTables(_edb: Database) {
  const ccpr = await _edb.run(
    `CREATE TABLE IF NOT EXISTS button_event
      (
        etime INTEGER,
        event_type INTEGER,
        temp_c REAL,
        illuminance_lux REAL,
        PRIMARY KEY (etime)
      );`,
  )
  logger.info(
    `initButtonEventTables(): CREATE button_event table: ${JSON.stringify(ccpr)}`,
  )

  const cidx = await _edb.run(
    `CREATE INDEX IF NOT EXISTS be_event_type_idx ON button_event(event_type);`,
  )
  logger.info(
    `initButtonEventTables(): CREATE INDEX on button_event table: ${JSON.stringify(cidx)}`,
  )
}

async function insertButtonEvent(
  _db: Database,
  _edb: Database,
  mqttClient: mqtt.MqttClient,
  buttonEventStr: string,
) {
  const evStr = buttonEventStr.trim()
  const stmt = _edb.prepare(
    `INSERT INTO button_event (etime, event_type, temp_c, illuminance_lux) ` +
      `VALUES ($etime, $eventType, $tempC, $illuminanceLux);`,
  )

  const buttonEventResponse = [
    { eventName: 'in_bed', eventType: 10, responseTone: 1 },
    { eventName: 'awake', eventType: 20, responseTone: 3 },
    { eventName: 'up_from_bed', eventType: 30, responseTone: 5 },
  ]

  const evtResponse = buttonEventResponse.find(
    (bert) => bert.eventName === evStr,
  )
  if (evtResponse) {
    const res = _db.prepare(
      'SELECT mtime, illuminance_lux, temp_c FROM illuminance ' +
        'ORDER BY mtime DESC ' +
        'LIMIT 1;',
    )
    const rows = res.all()
    let illuminanceLux: number | null = null
    let tempC: number | null = null

    if (rows && rows[0]) {
      logger.debug(
        `insertButtonEvent(): latestEnv = ${JSON.stringify(rows[0])}`,
      )
      const latestEnv = rows[0] as any
      if (Number.isFinite(latestEnv.temp_c)) {
        tempC = parseFloat(latestEnv.temp_c)
      } else {
        logger.info(
          `insertButtonEvent(): temp_c is not a finite number: ${latestEnv.temp_c}`,
        )
      }
      if (Number.isFinite(latestEnv.illuminance_lux)) {
        illuminanceLux = parseFloat(latestEnv.illuminance_lux)
      } else {
        logger.info(
          `insertButtonEvent(): illuminance_lux is not a finite number: ${latestEnv.illuminance_lux}`,
        )
      }
    }

    try {
      logger.debug(
        `insertButtonEvent(): inserting button_event: ${JSON.stringify({
          etime: Date.now(),
          eventType: evtResponse.eventType,
          tempC,
          illuminanceLux,
        })}`,
      )
      stmt.run({
        $etime: Date.now(),
        $eventType: evtResponse.eventType,
        $tempC: tempC,
        $illuminanceLux: illuminanceLux,
      })
    } catch (err) {
      logger.warn(
        `insertButtonEvent(): database button_event insert error: ${err}`,
      )
    }
    await playToneOnDevice(mqttClient, evtResponse.responseTone)
  }

  if (evStr === 'check_status') {
    const latestButtonEvent = await getLatestButtonEvent(_edb)
    if (latestButtonEvent) {
      const er = buttonEventResponse.find(
        (r) => r.eventType === latestButtonEvent.event_type,
      )
      if (er) {
        await playToneOnDevice(mqttClient, er.responseTone)
      }
    }
  }
}

async function getLatestIlluminanceReading(_db: Database) {
  const res = await _db.prepare(
    `SELECT mtime, illuminance_lux FROM illuminance ORDER BY mtime DESC LIMIT 1;`,
  )
  const rows = res.all()

  const IlluminaceMeasurement = z.object({
    mtime: z.date(),
    illuminance_lux: z.number(),
  })

  const parseRes = await IlluminaceMeasurement.safeParseAsync(rows[0])
  if (parseRes.error) {
    logger.error(
      'isItDarkRightNow(): illuminance reading parsing failed: ' +
        parseRes.error,
    )
    return null
  }
  const lastIlluminance = parseRes.data

  return lastIlluminance
}

async function isItDarkRightNow(_db: Database) {
  const lastIlluminance = await getLatestIlluminanceReading(_db)
  if (!lastIlluminance) {
    return null
  }

  return { ...lastIlluminance, isDark: lastIlluminance.illuminance_lux < 20 }
}

async function getLatestButtonEvent(
  _edb: Database,
  { sinceUnixTimestamp = 0 }: { sinceUnixTimestamp?: number } = {},
) {
  logger.debug(
    `getLatestButtonEvent(): sinceUnixTimestamp = ${sinceUnixTimestamp}`,
  )
  const stmt = _edb.prepare(
    `
    SELECT etime, event_type, temp_c, illuminance_lux
      FROM button_event
      WHERE etime >= $sinceUnixTimestamp
      ORDER BY etime DESC LIMIT 1;
    `,
  )
  stmt.run({ $sinceUnixTimestamp: sinceUnixTimestamp })
  const rows = stmt.all()

  const parseRes = await buttonEvent.safeParseAsync(rows[0])
  if (parseRes.success) {
    return parseRes.data!
  }
  logger.info(
    'getLatestButtonEvent(): button_event parsing failed: ' + parseRes.error,
  )
  return null
}

async function shouldAlarmBePlayed(
  _db: Database,
  _edb: Database,
  { now: _now = -1 }: { now?: number } = {},
) {
  // check if the latest button event is in_bed (=10)
  // check if the latest button event is from less than 14 hours ago
  // check if it's been consistently dark for the last X minutes
  // -- accept the hasItBeenDark() default for how long of the past period to sample
  // -- at least 95% of the illuminance sample should be below the dark threshhold
  // check if the power-monitored device is off and has been off for at least a few minutes
  // return true if all of the above are true

  const now = _now === -1 ? Date.now() : _now
  const sinceUnixTimestamp = now - 14 * 60 * 60 * 1000

  logger.info(
    `shouldAlarmBePlayed(): now = ${now}, sinceUnixTimestamp = ${sinceUnixTimestamp}`,
  )

  const latestButtonEvent = await getLatestButtonEvent(_edb, {
    sinceUnixTimestamp: sinceUnixTimestamp,
  }) // in_bed within the last 14 hours
  const darkInfo = await hasItBeenDark(_db, { refTime: now })
  const devicePowerInfo = await hasDeviceBeenOff(_db)
  const devicePowerStats = await getDevicePowerStats(_db)

  const decisionData = {
    lastButton: latestButtonEvent?.event_type,
    darkRatio: darkInfo?.darkRatio,
    offRatio: devicePowerInfo?.offRatio,
    lmWatt: devicePowerInfo?.lastMeasuredPowerWatt,
    ...devicePowerStats,
  }
  logger.debug(
    `shouldAlarmBePlayed(): decisionData: ${JSON.stringify(decisionData)}`,
  )

  if (
    latestButtonEvent?.event_type !== ButtonEventType.InBed &&
    latestButtonEvent?.event_type !== ButtonEventType.Awake
  ) {
    logger.debug(
      `shouldAlarmBePlayed(): latest button press type is neither InBed or Awake`,
    )
    return false
  }

  // no further button presses after awake was pressed 15 min ago
  // TODO: We may want to do this only in the morning, but will leave as is
  // for now
  if (latestButtonEvent.event_type === ButtonEventType.Awake) {
    if (now - latestButtonEvent.etime > 15 * 60 * 1000) {
      return true
    }
    logger.debug(
      `shouldAlarmBePlayed(): latest button press type is Awake, but it was less than 15 minutes ago`,
    )
    return false
  }

  // in_bed button was pressed less than 3 minutes ago
  if (now - latestButtonEvent.etime < 3 * 60 * 1000) {
    logger.debug(
      `shouldAlarmBePlayed(): latest button press type is InBed, but it was less than 3 minutes ago`,
    )
    return false
  }

  if (
    devicePowerInfo &&
    (devicePowerInfo.offRatio <= 0.95 ||
      devicePowerInfo.lastMeasuredPowerWatt >= DEVICE_POWER_ON_THRESHOLD_WATT)
  ) {
    logger.debug(
      `shouldAlarmBePlayed(): device power level is not within thresholds`,
    )
    return false
  }

  if (devicePowerStats) {
    // power use is definitely above the maximum level seen during stand-by
    // using the average has the effect of delaying the alarm,
    // possibly as long as the sensor reading period (300 seconds by default)
    if (devicePowerStats.powerWattAvg >= DEVICE_POWER_ON_THRESHOLD_WATT) {
      logger.debug(
        `shouldAlarmBePlayed(): device power average is above threshold`,
      )
      return false
    }

    // power sensor is not reporting any data
    if (devicePowerStats.numReadings < 1) {
      logger.debug(
        `shouldAlarmBePlayed(): device power sensor is not reporting any data`,
      )
      return false
    }

    // device is likely in a transitional state between active, standby, sleep
    if (
      devicePowerStats.powerWattVarPop > DEVICE_POWER_VARIANCE_POP_THRESHOLD
    ) {
      logger.debug(
        `shouldAlarmBePlayed(): device power variance is above threshold`,
      )
      return false
    }
  } else {
    // do not play alarm just because the power sensor reading failed
    logger.debug(
      `shouldAlarmBePlayed(): device power sensor stats couldn't be read, do not play alarm`,
    )
    return false
  }

  if (darkInfo?.darkRatio && darkInfo.darkRatio > 0.95) {
    logger.debug(`shouldAlarmBePlayed(): illuminance is below threshold`)
    return true
  }

  // If it's past 6 AM in the morning, and the user hasn't pressed the
  // 'awake' button, we play reveille jingle on the button/alarm device
  // even if illuminance is above the threshold.
  const dtFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: process.env.USER_TIMEZONE!,
    hour: 'numeric',
    hour12: false,
  })
  const hour = Number.parseInt(
    dtFormatter.formatToParts(new Date(now)).find((p) => p.type === 'hour')
      ?.value!,
  )
  if (hour >= 6 && hour <= 13) {
    logger.debug(
      `shouldAlarmBePlayed(): it's past 6 AM in the morning, ignore illuminance and play alarm`,
    )
    return true
  }

  return false
}

async function getButtonEvents(
  _edb: Database,
  {
    forSec = 60 * 60 * 24 * 2,
    refTime = -1,
  }: {
    forSec?: number
    refTime?: number
  } = {},
) {
  const sql =
    `SELECT etime, event_type, temp_c, illuminance_lux ` +
    `FROM button_event ` +
    `WHERE etime >= $unixTimeMs - $forMs ` +
    `AND etime <= $unixTimeMs ` +
    `ORDER BY etime DESC;`

  const unixTimeMs = refTime === -1 ? Date.now() : refTime

  const stmt = _edb.prepare(sql)
  stmt.run({
    $unixTimeMs: unixTimeMs,
    $forMs: forSec * 1000,
  })
  const res = stmt.all()

  const buttonEventArray = z.array(buttonEvent)

  const parseRes = await buttonEventArray.safeParseAsync(res)

  if (parseRes.error) {
    logger.warn(
      `getButtonEvents(): data returned from database wasn't valid, error msg: ${parseRes.error}`,
    )
    return null
  }
  return parseRes.data
}
/*
TODO: There needs to be a way retrieve the button event times so that you can know
when you went to bed, when you awoke, when you got out, etc.
MAYBE: Perhaps there should be a button on the button/alarm device to check the
current status? For example, is it in in_bed, awake, out_of_bed? It would play
the "response" jingle corresponding to the status? This would also work as a way to
check if the button/alarm device is connected to the server-side off-alarm program
correctly.
MAYBE: Perhaps the illuminance threshold should be adjusted so that alarm works
during the early mornings when the sun has rose and the room isn't pitch black.
Room light is about 21 lux, bedside light is about 42 lux, 8:30 AM in early August
w/ curtains drawn is about 10 lux, 10:15 AM w/ one side of curtain open is 44 lux.
We can't completley ignore illumiance since after 'in_bed' event, off-alarm
sees if the illuminance is less than 20 lux to see if the light has been turned off,
and the user actually intends to start sleeping as opposed to lying awake
in bed with lights on.

MAYBE: There is a problem where the alarm tone keeps playing even after the device
has been turned back on because the device power use is only checked every
30 seconds. Perhaps a way to get around this is to suspend alarm for 30 seconds
after any button event is received.
*/

async function main() {
  const influxdb = await getInfluxDb()

  // await initDuckTables(duck)
  await initSqliteTables(db)
  await initButtonEventTables(edb)

  const k = await getDevicePowerReadings(influxdb, db)
  logger.info(`main(): getDevicePowerReadings(): ${JSON.stringify(k)}`)

  const l = await getIlluminanceReadings(influxdb, db)
  logger.info(`main(): getIlluminanceReadings(): ${JSON.stringify(l)}`)

  const devicePower = db
    .prepare(`SELECT * FROM device_power ORDER BY mtime DESC limit 10`)
    .all()

  logger.info(`main(): devicePower: ${JSON.stringify(devicePower[0])}`)

  const numIlluminanceReadingsInDb = db
    .prepare(`SELECT COUNT(*) AS illuminance_count FROM illuminance;`)
    .all() as any[]
  logger.info(
    `main(): number of illuminance measurements in database: ${numIlluminanceReadingsInDb[0].illuminance_count!}`,
  )

  const mqttClient = await mqtt.connectAsync(process.env.MQTT_SERVER_URI!, {
    username: process.env.MQTT_USERNAME!,
    password: process.env.MQTT_PASSWORD!,
    reconnectPeriod: 1000,
    reconnectOnConnackError: true,
  })

  const powerTopic = process.env.USE_FAKE_SENSORS
    ? process.env.MQTT_TOPIC_DEVICE_POWER_STATUS_FAKE!
    : process.env.MQTT_TOPIC_DEVICE_POWER_STATUS!
  logger.info(`main(): mqttClient: subscribe to ${powerTopic}`)
  await mqttClient.subscribeAsync(powerTopic) // power device

  const illumTopic = process.env.USE_FAKE_SENSORS
    ? process.env.MQTT_TOPIC_ILLUMINANCE_SENSOR_STATUS_FAKE!
    : process.env.MQTT_TOPIC_ILLUMINANCE_SENSOR_STATUS!
  logger.info(`main(): mqttClient: subscribe to ${illumTopic}`)
  await mqttClient.subscribeAsync(illumTopic) // illuminance sensor

  // bedside button/alarm module input events, either "awake" or "in_bed"
  await mqttClient.subscribeAsync(process.env.MQTT_TOPIC_BUTTONS_EVENT!)
  mqttClient.on('message', async (topic, payload) => {
    if (topic === powerTopic) {
      const str = payload.toString()
      logger.debug(`MQTT receive: device power: ${str}`)
      await insertDevicePowerReading(db, str)
    } else if (topic === illumTopic) {
      const str = payload.toString()
      logger.debug(`MQTT receive: env sensors: ${str}`)
      await insertIlluminanceSensorsReading(db, str)
    } else if (topic === process.env.MQTT_TOPIC_BUTTONS_EVENT!) {
      const str = payload.toString()
      logger.info(`MQTT receive: button event: ${str}`)
      await insertButtonEvent(db, edb, mqttClient, str)
    }
  })

  setInterval(async () => {
    // const res = await isItDarkRightNow()
    // logger.info(`interval: isItDarkRightNow?: ${JSON.stringify(res)}`)

    // const hres = await hasItBeenDark({ forSec: 300 })
    // logger.info(`interval: hasItBeenDark(): ${JSON.stringify(hres)}`)

    // const eres = await getLatestButtonEvent()
    // logger.info(`interval: getLatestButtonEvent(): ${JSON.stringify(eres)}`)

    // const ires = await shouldAlarmBePlayed()
    // logger.info(`interval: isUserLikelyInBed(): ${ires}`)

    // const dres = await hasDeviceBeenOff()
    // logger.info(`interval: hasPowerDeviceBeenOff(): ${JSON.stringify(dres)}`)

    const alarmRes = await shouldAlarmBePlayed(db, edb)
    logger.debug(
      `alarm check interval: shouldAlarmBePlayed(): ${JSON.stringify(alarmRes)}`,
    )
    if (alarmRes) {
      await playToneOnDevice(mqttClient, 7)
    }
  }, 13000) // 13 seconds because the Reveille (tune #8) takes about 12 seconds to play

  const webServer = Bun.serve({
    async fetch(req) {
      const url = new URL(req.url)
      if (url.pathname === '/api/v1/button-events') {
        const beRes = await getButtonEvents(edb)
        const r = new Response(JSON.stringify(beRes))
        r.headers.set('Content-Type', 'application/json; charset=utf-8')
        return r
      } else if (url.pathname === '/') {
        const r = new Response(Bun.file('./frontend/dist/index.html'))
        r.headers.set('Content-Type', 'Content-Type: text/html; charset=utf-8')
        return r
      } else if (url.pathname.startsWith('/assets/')) {
        const filename = url.pathname.split('/').pop()
        try {
          const assetFile = Bun.file(`./frontend/dist/assets/${filename}`)
          const r = new Response(assetFile)
          if (filename?.endsWith('.js')) {
            r.headers.set(
              'Content-Type',
              'application/javascript;charset=utf-8',
            )
          } else if (filename?.endsWith('.css')) {
            r.headers.set('Content-Type', 'text/css;charset=utf-8')
          }
          return r
        } catch (error) {
          const r = new Response('404')
          return r
        }
      }
      return new Response('Hello world!')
    },
  })

  logger.info(`HTTP server started on ${webServer.hostname}:${webServer.port}`)
}

if (require.main === module) {
  main()
}
