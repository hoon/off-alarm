export interface ButtonEvent {
  etime: string
  event_type: number
  temp_c?: number
  illuminance_lux?: number
}

export const mockButtonEvents: ButtonEvent[] = [
  {
    etime: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 minutes ago
    event_type: 30, // Out of bed
    temp_c: 22.8,
    illuminance_lux: 120.4
  },
  {
    etime: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
    event_type: 20, // Awake
    temp_c: 22.0,
    illuminance_lux: 45.1
  },
  {
    etime: new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString(), // 10 hours ago
    event_type: 10, // In bed
    temp_c: 21.5,
    illuminance_lux: 15.2
  },
  {
    etime: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // 24 hours ago
    event_type: 30, // Out of bed
    temp_c: 23.0,
    illuminance_lux: 150.0
  },
  {
    etime: new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString(), // 36 hours ago
    event_type: 10, // In bed
    temp_c: 20.8,
    illuminance_lux: 8.5
  }
];
