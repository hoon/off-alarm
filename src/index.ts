import { InfluxDB } from '@influxdata/influxdb-client'
import { flux } from '@influxdata/influxdb-client'
import { Database as DuckDb } from 'duckdb-async'
import mqtt from 'mqtt'
import { z } from 'zod'
import pino from 'pino'
const logger = pino()

const influxdb = new InfluxDB({
  url: process.env.INFLUX_URL!,
  token: process.env.INFLUX_TOKEN,
})

/*
  DuckDB UNIX time function quirk:
  You need to include "AT TIME ZONE 'UTC'" when using epoch_ms() because it returns timestamp w/o timezone.

  If UNIX time 1722546770129 is '2024-08-01 21:12:50.129' in UTC,
  epoch_ms(1722546770129) will return '2024-08-01 21:12:50.129' without time zone.

  Simply casting the result of epoch_ms() to TIMESTAMPTZ will give you
  '2024-08-01 21:12:50.129' in your local time zone,
  e.g. '2024-08-01 21:12:50.129-04'

  You have to explicitly state the time zone like the following to get the correct date time.
  epoch_ms(1722546770129) AT TIME ZONE 'UTC'

  This gives you '2024-08-01 17:12:50.129-04', which is correct.

  This is the DuckDB epoch time conversion behavior as of version 1.0.0.
  */

const duck = await DuckDb.create(':memory:')
const educk = await DuckDb.create('button_event.duckdb')

const mqttClient = mqtt.connect(process.env.MQTT_SERVER_URI!, {
  username: process.env.MQTT_USERNAME!,
  password: process.env.MQTT_PASSWORD!,
})

const buttonEvent = z.object({
  etime: z.date(),
  event_type: z.number(),
})

type ButtonEvent = z.infer<typeof buttonEvent>

enum ButtonEventType {
  InBed = 10,
  Awake = 20,
  UpFromBed = 30,
}

const DEVICE_POWER_ON_THRESHOLD_WATT =
  process.env.DEVICE_POWER_ON_THRESHOLD_WATT || 5

export async function getDevicePowerReadings() {
  const queryApi = influxdb.getQueryApi(process.env.INFLUX_ORG!)
  // const filter = flux` and r._time >= ${Date.now() - 60 * 60 * 1000}`
  const fluxQuery = flux`
    import "math"
    from(bucket:${process.env.INFLUX_DEVICE_POWER_BUCKET})
      |> range(start:0)
      |> filter(fn: (r) => r._measurement == "${process.env.INFLUX_DEVICE_POWER_MEASUREMENT}")
      |> range(start: -300s)
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
        const time = o._time
        const powerWatt = o._value
        if (powerWatt == undefined || powerWatt == null) {
          return
        }
        powerWattReadings.push({ time: o.unix_time, powerWatt })

        const stmt = duck.prepare(
          `INSERT INTO device_power (mtime, power_watt) ` + `VALUES (?, ?);`,
        )

        stmt.then(async (_stmt) => {
          try {
            await _stmt.run(o._time, powerWatt)
          } catch (err) {
            logger.warn(
              `getDevicePowerReadings(): DuckDB device_power table insert error: ${err}`,
            )
          } finally {
            await _stmt.finalize()
          }
        })
      },
      error: reject,
      complete() {
        resolve(powerWattReadings)
      },
    })
  })
}

export async function getIlluminanceReadings() {
  const queryApi = influxdb.getQueryApi(process.env.INFLUX_ORG!)
  const fluxQuery = flux`
    import "math"
    from(bucket:"${process.env.INFLUX_ENV_READINGS_BUCKET!}")
      |> range(start: -300s)
      |> filter(fn: (r) => r._measurement == "${process.env.INFLUX_ENV_READINGS_MEASUREMENT}" and r._field == "illuminance_lux")
      |> map(fn: (r) => ({_time: r._time, _value: r._value, unix_time: uint(v: r._time) / uint(v: 1000000)}))
  `

  const illuminanceReadings: { time: number; illuminanceLux: number }[] = []
  return await new Promise((resolve, reject) => {
    queryApi.queryRows(fluxQuery, {
      next(row, tableMeta) {
        const o = tableMeta.toObject(row)
        const illuminanceLux = o._value
        if (illuminanceLux == undefined || illuminanceLux == null) {
          return
        }
        illuminanceReadings.push({ time: o.unix_time, illuminanceLux })

        const stmt = duck.prepare(
          `INSERT INTO illuminance (mtime, illuminance_lux) ` +
            `VALUES (?, ?);`,
        )

        stmt.then(async (_stmt) => {
          try {
            logger.debug(
              `getIlluminanceReadings(): inserting {${o._time}, ${illuminanceLux}}}`,
            )
            await _stmt.run(o._time, illuminanceLux)
          } catch (err) {
            logger.warn(
              `getIlluminanceReadings(): DuckDB illuminance insert error: ${err}`,
            )
          } finally {
            await _stmt.finalize()
          }
        })
      },
      error: reject,
      complete() {
        resolve(illuminanceReadings)
      },
    })
  })
}

async function initDuckTables() {
  const ccpr = await duck.run(
    `CREATE TABLE device_power
      (
        mtime TIMESTAMPTZ,
        power_watt INT,
        PRIMARY KEY (mtime)
      );`,
  )
  logger.info(
    `initDuckTables(): CREATE TABLE device_power: ${JSON.stringify(ccpr)}`,
  )
  const cilr = await duck.run(
    `CREATE TABLE illuminance
      (
        mtime TIMESTAMPTZ,
        illuminance_lux REAL,
        PRIMARY KEY (mtime)
      );`,
  )
  logger.info(
    `initDuckTables(): CREATE TABLE illuminance: ${JSON.stringify(cilr)}`,
  )
}

// TODO: make it accept refTime to allow for testing on example data set
async function hasDeviceBeenOff(forSec: number = 300) {
  const countOffVsAllSql = `
    WITH
      off_m AS (
        SELECT COUNT(*) AS num_device_off
          FROM device_power
          WHERE mtime >= (epoch_ms(?::BIGINT) AT TIME ZONE 'UTC'- INTERVAL (?) SECOND)::TIMESTAMPTZ
          AND mtime <= (epoch_ms(?::BIGINT) AT TIME ZONE 'UTC')
          AND power_watt < ?
      ),
      all_m AS (
        SELECT COUNT(*) AS num_all
          FROM device_power
          WHERE mtime >= (epoch_ms(?::BIGINT) AT TIME ZONE 'UTC' - INTERVAL (?) SECOND)::TIMESTAMPTZ
          AND mtime <= (epoch_ms(?::BIGINT) AT TIME ZONE 'UTC')
      ),
      avg_m AS (
        SELECT AVG(power_watt) AS avg_power_watt
          FROM device_power
          WHERE mtime >= (epoch_ms(?::BIGINT) AT TIME ZONE 'UTC' - INTERVAL (?) SECOND)::TIMESTAMPTZ
          AND mtime <= (epoch_ms(?::BIGINT) AT TIME ZONE 'UTC')
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
  const stmt = await duck.prepare(countOffVsAllSql)
  try {
    const res = await stmt.all(
      unixTimeMs,
      forSec,
      unixTimeMs,
      DEVICE_POWER_ON_THRESHOLD_WATT,
      unixTimeMs,
      forSec,
      unixTimeMs,
      unixTimeMs,
      forSec,
      unixTimeMs,
    )

    if (res && res[0]) {
      return {
        numDeviceOff: Number.parseInt(res[0].num_device_off!),
        numAll: Number.parseInt(res[0].num_all!),
        offRatio: Number.parseFloat(res[0].off_ratio!),
        averagePowerWatt: Number.parseFloat(res[0].avg_power_watt!),
        lastMeasuredPowerWatt: Number.parseInt(res[0].last_m_power_watt!),
      }
    }
  } catch (err) {
    logger.error(
      `hasDeviceBeenOff(): error while retrieving from DuckDB: ${err}`,
    )
  }
  return null
}

/*
 * hasItBeenDark() retrieves illuminance values from a time period and
 * calculates the ratio of measurements where the measured illuminance
 * indicates it was dark vs ones that indicate it was bright.
 *
 * Being dark is defined as below 20 lux.
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
async function hasItBeenDark({
  forSec = 300,
  refTime = -1,
}: {
  forSec?: number
  refTime?: number
} = {}) {
  const countDarkVsAllSql = `
    WITH
      off_m AS (
        SELECT COUNT(*) AS num_dark
          FROM illuminance
          WHERE mtime >= (epoch_ms(?::BIGINT) AT TIME ZONE 'UTC' - INTERVAL (?) SECOND)
          AND mtime <= (epoch_ms(?::BIGINT) AT TIME ZONE 'UTC')
          AND illuminance_lux < 20
      ),
      all_m AS (
        SELECT COUNT(*) AS num_all
          FROM illuminance
          WHERE mtime >= (epoch_ms(?::BIGINT) AT TIME ZONE 'UTC' - INTERVAL (?) SECOND)
          AND mtime <= (epoch_ms(?::BIGINT) AT TIME ZONE 'UTC')
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
        off_m.num_dark / all_m.num_all AS dark_ratio,
        last_m.last_m_illuminance_lux
      FROM off_m, all_m, last_m
    ;`

  const mtime = Math.floor(refTime === -1 ? Date.now() : refTime)
  const stmt = await duck.prepare(countDarkVsAllSql)
  try {
    const res = await stmt.all(mtime, forSec, mtime, mtime, forSec, mtime)

    if (res && res[0]) {
      return {
        numDark: parseInt(res[0].num_dark),
        numAll: parseInt(res[0].num_all),
        darkRatio: !Number.isNaN(res[0].dark_ratio)
          ? parseFloat(res[0].dark_ratio)
          : null,
        lastIlluminanceLux: parseFloat(res[0].last_m_illuminance_lux),
      }
    }
  } catch (err) {
    logger.error(`hasItBeenDark(): error while retrieving from DuckDB: ${err}`)
  }
  return null
}

async function getAllIlluminance() {
  const illuminanceSql = `
    SELECT mtime, illuminance_lux
      FROM illuminance
      ORDER BY mtime DESC
      LIMIT 10;
  `
  try {
    const res = await duck.all(illuminanceSql)
    logger.info(`getAllIlluminance(): ${res}`)
  } catch (err) {
    logger.error(`getAllIlluminance(): error retrievign from DuckDB: ${err}`)
  }
}

async function playToneOnDevice(tone = 1) {
  return mqttClient.publishAsync(
    process.env.MQTT_TOPIC_BUTTONS_COMMAND!,
    `n=playTone;p=${tone}`,
  )
}

async function flushOldMeasurements({ refTime = -1, secToKeep = 300 }) {
  const stmt = await duck.prepare(`
    DELETE
      FROM device_power
      WHERE mtime < (epoch_ms(?::BIGINT) AT TIME ZONE 'UTC' - INTERVAL (?) SECOND)::TIMESTAMPTZ
      ;
    DELETE
      FROM illuminance
      WHERE mtime < (epoch_ms(?::BIGINT) AT TIME ZONE 'UTC' - INTERVAL (?) SECOND)::TIMESTAMPTZ
    ;
  `)

  const time = refTime === -1 ? Date.now() : refTime
  try {
    await stmt.run(time, secToKeep, time, secToKeep)
  } catch (err) {
    logger.warn(
      `flushOldMeasurements(): Error occurred while attempting to delete old measurements: ${err}`,
    )
  }
}

async function insertDevicePowerReading(devicePowerReadingStr: string) {
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

  const stmt = duck.prepare(
    `INSERT INTO device_power (mtime, power_watt) ` +
      `VALUES (epoch_ms(?::BIGINT) AT TIME ZONE 'UTC', ?);`,
  )

  stmt.then(async (_stmt) => {
    try {
      await _stmt.run(
        Date.now(), // k.data.StatusSNS.Time is in Amsterdam time because that's where the Tasmota binary was compiled
        k.data.StatusSNS.ENERGY.Power,
      )
    } catch (err) {
      logger.warn(
        `insertDevicePowerReading: DuckDB device_power table insert error: ${err}`,
      )
    } finally {
      await _stmt.finalize()
    }
  })
}

async function insertIlluminanceSensorsReading(envSensorsReadingStr: string) {
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
  const stmt = duck.prepare(
    `INSERT INTO illuminance (mtime, illuminance_lux) ` +
      `VALUES (epoch_ms(?::BIGINT) AT TIME ZONE 'UTC', ?);`,
  )

  stmt.then(async (_stmt) => {
    try {
      await _stmt.run(
        Date.now(), // k.data.StatusSNS.Time is in Amsterdam time because that's where Tasmota binary was compiled
        k.data.StatusSNS.TSL2561.Illuminance,
      )
    } catch (err) {
      logger.warn(
        `insertIlluminanceSensorsReading(): DuckDB illuminance table insert error: ${err}`,
      )
    } finally {
      await _stmt.finalize()
    }
  })
}

async function initButtonEventTables() {
  const ccpr = await educk.run(
    `CREATE TABLE IF NOT EXISTS button_event
      (
        etime TIMESTAMPTZ,
        event_type INT,
        PRIMARY KEY (etime)
      );`,
  )
  logger.info(
    `initButtonEventTables(): CREATE button_event table: ${JSON.stringify(ccpr)}`,
  )

  const cidx = await educk.run(
    `CREATE INDEX IF NOT EXISTS be_event_type_idx ON button_event(event_type);`,
  )
  logger.info(
    `initButtonEventTables(): CREATE INDEX on button_event table: ${JSON.stringify(cidx)}`,
  )
}

async function insertButtonEvent(buttonEventStr: string) {
  const evStr = buttonEventStr.trim()
  const stmt = await educk.prepare(
    `INSERT INTO button_event (etime, event_type) ` +
      `VALUES (epoch_ms(?::BIGINT) AT TIME ZONE 'UTC', ?);`,
  )
  // Object.keys(eventStrsToInt).forEach(async (evKey) => {
  //   if (evStr === evKey) {
  //     await educk.prepare(stmt, Date.now(), eventStrsToInt[evKey])
  //   }
  // })

  const buttonEventResponse = [
    { eventName: 'in_bed', eventType: 10, responseTone: 1 },
    { eventName: 'awake', eventType: 20, responseTone: 3 },
    { eventName: 'up_from_bed', eventType: 30, responseTone: 5 },
  ]

  const evtResponse = buttonEventResponse.find(
    (bert) => bert.eventName === evStr,
  )
  if (evtResponse) {
    await stmt.run(Date.now(), evtResponse.eventType)
    await playToneOnDevice(evtResponse.responseTone)
  }

  if (evStr === 'check_status') {
    const latestButtonEvent = await getLatestButtonEvent()
    if (latestButtonEvent) {
      const er = buttonEventResponse.find(
        (r) => r.eventType === latestButtonEvent.event_type,
      )
      if (er) {
        await playToneOnDevice(er.responseTone)
      }
    }
  }
}

async function getLatestIlluminanceReading() {
  const res = await duck.all(
    `SELECT mtime, illuminance_lux FROM illuminance ORDER BY mtime DESC LIMIT 1;`,
  )

  const IlluminaceMeasurement = z.object({
    mtime: z.date(),
    illuminance_lux: z.number(),
  })

  const parseRes = await IlluminaceMeasurement.safeParseAsync(res[0])
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

async function isItDarkRightNow() {
  const lastIlluminance = await getLatestIlluminanceReading()
  if (!lastIlluminance) {
    return null
  }

  return { ...lastIlluminance, isDark: lastIlluminance.illuminance_lux < 20 }
}

async function getLatestButtonEvent({
  sinceUnixTimestamp = 0,
}: { sinceUnixTimestamp?: number } = {}) {
  logger.debug(
    `getLatestButtonEvent(): sinceUnixTimestamp = ${sinceUnixTimestamp}`,
  )
  const stmt = await educk.prepare(
    `SELECT etime, event_type FROM button_event ` +
      `WHERE etime >= epoch_ms(?::BIGINT) AT TIME ZONE 'UTC' ` +
      `ORDER BY etime DESC LIMIT 1;`,
  )
  const res = await stmt.all(sinceUnixTimestamp)

  // const res = await educk.all(
  //   `SELECT etime, event_type FROM button_event ORDER BY etime DESC LIMIT 1;`,
  // )

  const parseRes = await buttonEvent.safeParseAsync(res[0])
  if (parseRes.success) {
    return parseRes.data!
  }
  return null
}

async function shouldAlarmBePlayed({ now: _now = -1 }: { now?: number } = {}) {
  // check if the latest button event is in_bed (=10)
  // check if the latest button event is from less than 14 hours ago
  // check if it's been consistently dark for the last X minutes
  // -- accept the hasItBeenDark() default for how long of the past period to sample
  // -- at least 95% of the illuminance sample should be below the dark threshhold
  // check if the power-monitored device is off and has been off for at least a few minutes
  // return true if all of the above are true

  const now = _now === -1 ? Date.now() : _now

  const latestButtonEvent = await getLatestButtonEvent({
    sinceUnixTimestamp: now - 14 * 60 * 60 * 1000,
  }) // in_bed within the last 14 hours
  const darkInfo = await hasItBeenDark({ refTime: now })
  const devicePowerInfo = await hasDeviceBeenOff()

  const decisionData = {
    lastButton: latestButtonEvent?.event_type,
    darkRatio: darkInfo?.darkRatio,
    offRatio: devicePowerInfo?.offRatio,
    lmWatt: devicePowerInfo?.lastMeasuredPowerWatt,
  }
  logger.debug(
    `shouldAlarmBePlayed(): decisionData: ${JSON.stringify(decisionData)}`,
  )

  if (latestButtonEvent?.event_type !== ButtonEventType.InBed) {
    return false
  }

  // in_bed button was pressed less than 3 minutes ago
  if (now - latestButtonEvent.etime.getTime() < 3 * 60 * 1000) {
    return false
  }

  if (
    devicePowerInfo &&
    (devicePowerInfo.offRatio <= 0.95 ||
      devicePowerInfo.lastMeasuredPowerWatt >= 5)
  ) {
    return false
  }

  if (darkInfo?.darkRatio && darkInfo.darkRatio > 0.95) {
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
    return true
  }

  return false
}

async function getButtonEvents({
  forSec = 60 * 60 * 24 * 2,
  refTime = -1,
}: {
  forSec?: number
  refTime?: number
} = {}) {
  const sql =
    `SELECT etime, event_type ` +
    `FROM button_event ` +
    `WHERE etime >= epoch_ms(?::BIGINT) AT TIME ZONE 'UTC' - INTERVAL (?) SECOND ` +
    `AND etime <= epoch_ms(?::BIGINT) AT TIME ZONE 'UTC' ` +
    `ORDER BY etime DESC;`

  const unixTimeMs = refTime === -1 ? Date.now() : refTime

  const stmt = await educk.prepare(sql)
  const res = await stmt.all(unixTimeMs, forSec, unixTimeMs)

  const buttonEventArray = z.array(buttonEvent)

  const parseRes = await buttonEventArray.safeParseAsync(res)

  if (parseRes.error) {
    logger.warn(
      `getButtonEvents(): data returned from DuckDB wasn't valid, error msg: ${parseRes.error}`,
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
  await initDuckTables()
  await initButtonEventTables()

  const k = await getDevicePowerReadings()
  logger.info(`main(): getDevicePowerReadings(): ${JSON.stringify(k)}`)

  const l = await getIlluminanceReadings()
  logger.info(`main(): getIlluminanceReadings(): ${JSON.stringify(l)}`)

  const duckDevicePower = await duck.all(
    `SELECT * FROM device_power ORDER BY mtime DESC limit 10`,
  )

  logger.info(`main(): duckDevicePower: ${JSON.stringify(duckDevicePower[0])}`)

  const numIlluminanceReadingsInDb = await duck.all(
    `SELECT COUNT(*) AS illuminance_count FROM illuminance;`,
  )
  logger.info(
    `main(): number of illuminance measurements in DuckDB: ${numIlluminanceReadingsInDb[0].illuminance_count!}`,
  )

  await mqttClient.subscribeAsync(process.env.MQTT_TOPIC_DEVICE_POWER_STATUS!) // power device
  await mqttClient.subscribeAsync(
    process.env.MQTT_TOPIC_ILLUMINANCE_SENSOR_STATUS!,
  ) // illuminance sensor

  // bedside button/alarm module input events, either "awake" or "in_bed"
  await mqttClient.subscribeAsync(process.env.MQTT_TOPIC_BUTTONS_EVENT!)
  mqttClient.on('message', async (topic, payload) => {
    if (topic === process.env.MQTT_TOPIC_DEVICE_POWER_STATUS!) {
      const str = payload.toString()
      logger.debug(`MQTT receive: device power: ${str}`)
      await insertDevicePowerReading(str)
    } else if (topic === process.env.MQTT_TOPIC_ILLUMINANCE_SENSOR_STATUS!) {
      const str = payload.toString()
      logger.debug(`MQTT receive: env sensors: ${str}`)
      await insertIlluminanceSensorsReading(str)
    } else if (topic === process.env.MQTT_TOPIC_BUTTONS_EVENT!) {
      const str = payload.toString()
      logger.info(`MQTT receive: button event: ${str}`)
      await insertButtonEvent(str)
    }
  })

  // await playToneOnDevice(8) // play Reveille on button/alarm device at start-up

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

    const alarmRes = await shouldAlarmBePlayed()
    if (alarmRes) {
      logger.info(`interval: shouldAlarmBePlayed(): ${alarmRes}`)
      await playToneOnDevice(8)
    } else {
      logger.debug(`interval: shouldAlarmBePlayed(): ${alarmRes}`)
    }
  }, 13000) // 13 seconds because the Reveille (tune #8) takes about 12 seconds to play

  const webServer = Bun.serve({
    async fetch(req) {
      const url = new URL(req.url)
      if (url.pathname === '/api/v1/button-events') {
        const beRes = await getButtonEvents()
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

main()
