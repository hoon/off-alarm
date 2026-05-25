import { type DecisionData, _TESTING } from '../src/index'
import { describe, expect, test, beforeAll, afterAll } from 'bun:test'

const {
  shouldAlarmBePlayed,
  shouldSleepPositionAlarmBePlayed,
  ButtonEventType,
} = _TESTING!

const originalTimezone = process.env.USER_TIMEZONE

beforeAll(() => {
  process.env.USER_TIMEZONE = 'UTC'
})

afterAll(() => {
  if (originalTimezone === undefined) {
    delete process.env.USER_TIMEZONE
  } else {
    process.env.USER_TIMEZONE = originalTimezone
  }
})

function getBaseDecisionData(): DecisionData {
  return {
    lastButtonType: ButtonEventType.InBed,
    lastButtonTime: Date.now() - 4 * 60 * 1000, // 4 mins ago
    darkRatio: 0.99,
    offRatio: 0.99,
    lastWatt: 2,
    powerWattAvg: 2,
    powerWattMax: 3,
    powerWattMin: 1,
    numReadings: 10,
    powerWattVarPop: 1,
  }
}

describe('shouldAlarmBePlayed', () => {
  test('returns false if lastButtonType is neither InBed nor Awake', async () => {
    const data = getBaseDecisionData()
    data.lastButtonType = ButtonEventType.UpFromBed
    expect(await shouldAlarmBePlayed({ decisionData: data })).toBe(false)
  })

  test('returns false if lastButtonType is Awake but pressed < 15 mins ago', async () => {
    const data = getBaseDecisionData()
    data.lastButtonType = ButtonEventType.Awake
    data.lastButtonTime = Date.now() - 14 * 60 * 1000
    expect(await shouldAlarmBePlayed({ decisionData: data })).toBe(false)
  })

  test('returns true if lastButtonType is Awake and pressed > 15 mins ago', async () => {
    const data = getBaseDecisionData()
    data.lastButtonType = ButtonEventType.Awake
    data.lastButtonTime = Date.now() - 16 * 60 * 1000
    expect(await shouldAlarmBePlayed({ decisionData: data })).toBe(true)
  })

  test('returns false if lastButtonType is InBed and pressed < 3 mins ago', async () => {
    const data = getBaseDecisionData()
    data.lastButtonTime = Date.now() - 2 * 60 * 1000
    expect(await shouldAlarmBePlayed({ decisionData: data })).toBe(false)
  })

  test('returns false if offRatio is <= 0.95', async () => {
    const data = getBaseDecisionData()
    data.offRatio = 0.9
    expect(await shouldAlarmBePlayed({ decisionData: data })).toBe(false)
  })

  test('returns false if lastWatt is >= DEVICE_POWER_ON_THRESHOLD_WATT', async () => {
    const data = getBaseDecisionData()
    data.lastWatt = 1000000
    expect(await shouldAlarmBePlayed({ decisionData: data })).toBe(false)
  })

  test('returns false if powerWattAvg >= DEVICE_POWER_ON_THRESHOLD_WATT', async () => {
    const data = getBaseDecisionData()
    data.powerWattAvg = 1000000
    expect(await shouldAlarmBePlayed({ decisionData: data })).toBe(false)
  })

  test('returns false if numReadings < 1', async () => {
    const data = getBaseDecisionData()
    data.numReadings = 0
    expect(await shouldAlarmBePlayed({ decisionData: data })).toBe(false)
  })

  test('returns false if powerWattVarPop > DEVICE_POWER_VARIANCE_POP_THRESHOLD', async () => {
    const data = getBaseDecisionData()
    data.powerWattVarPop = 4 // Default threshold is 3
    expect(await shouldAlarmBePlayed({ decisionData: data })).toBe(false)
  })

  test('returns false if power stats are undefined', async () => {
    const data = getBaseDecisionData()
    data.powerWattAvg = undefined as any
    expect(await shouldAlarmBePlayed({ decisionData: data })).toBe(false)
  })

  test('returns true if conditions met and darkRatio > 0.95', async () => {
    const data = getBaseDecisionData()
    expect(await shouldAlarmBePlayed({ decisionData: data })).toBe(true)
  })

  test('returns true if darkRatio <= 0.95 but time is between 6 AM and 1 PM', async () => {
    const data = getBaseDecisionData()
    data.darkRatio = 0.9
    // mock 'now' to be 8 AM UTC
    const now = new Date('2026-05-19T08:00:00Z').getTime()
    expect(await shouldAlarmBePlayed({ decisionData: data, now })).toBe(true)
  })

  test('returns false if darkRatio <= 0.95 and time is outside 6 AM and 1 PM', async () => {
    const data = getBaseDecisionData()
    data.darkRatio = 0.9
    // mock 'now' to be 4 AM UTC
    const now = new Date('2026-05-19T04:00:00Z').getTime()
    expect(await shouldAlarmBePlayed({ decisionData: data, now })).toBe(false)
  })
})

describe('shouldSleepPositionAlarmBePlayed', () => {
  test('returns false if lastButtonType is not InBed', async () => {
    const data = getBaseDecisionData()
    data.lastButtonType = ButtonEventType.Awake
    expect(
      await shouldSleepPositionAlarmBePlayed({
        decisionData: data,
        isUserInUndesirableSleepPosition: true,
      }),
    ).toBe(false)
  })

  test('returns false if darkRatio is < 0.95', async () => {
    const data = getBaseDecisionData()
    data.darkRatio = 0.9
    expect(
      await shouldSleepPositionAlarmBePlayed({
        decisionData: data,
        isUserInUndesirableSleepPosition: true,
      }),
    ).toBe(false)
  })

  test('returns false if user is not in undesirable sleep position', async () => {
    const data = getBaseDecisionData()
    expect(
      await shouldSleepPositionAlarmBePlayed({
        decisionData: data,
        isUserInUndesirableSleepPosition: false,
      }),
    ).toBe(false)
  })

  test('returns true if InBed, dark enough, and user is in undesirable sleep position', async () => {
    const data = getBaseDecisionData()
    expect(
      await shouldSleepPositionAlarmBePlayed({
        decisionData: data,
        isUserInUndesirableSleepPosition: true,
      }),
    ).toBe(true)
  })
})
