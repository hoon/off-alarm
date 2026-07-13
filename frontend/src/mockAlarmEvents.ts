export interface AlarmEvent {
  atime: number | string
  tune_no: number
  decision_data: string
}

export const mockAlarmEvents: AlarmEvent[] = [
  {
    atime: Date.now() - 10 * 60 * 1000, // 10 minutes ago
    tune_no: 9,
    decision_data: JSON.stringify({
      lastButtonType: 10,
      lastButtonTime: Date.now() - 30 * 60 * 1000,
      darkRatio: 0.98,
      offRatio: 1.0,
      lastWatt: 0.5,
      powerWattAvg: 0.4,
      powerWattMax: 0.6,
      powerWattMin: 0.3,
      numReadings: 15,
      powerWattVarPop: 0.1,
      isUserInUndesirableSleepPosition: true
    })
  },
  {
    atime: Date.now() - 3 * 60 * 60 * 1000, // 3 hours ago
    tune_no: 7,
    decision_data: JSON.stringify({
      lastButtonType: 10,
      lastButtonTime: Date.now() - 3.5 * 60 * 60 * 1000,
      darkRatio: 0.96,
      offRatio: 0.99,
      lastWatt: 0.2,
      powerWattAvg: 0.3,
      powerWattMax: 0.5,
      powerWattMin: 0.1,
      numReadings: 20,
      powerWattVarPop: 0.05
    })
  }
];
