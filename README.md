# off-alarm

## Work in progress

## Purpose

`off-alarm` intends to monitor if a critical device has been inadverdently turned off and alert user using audible alarm. It monitors messages from Tasmota nodes sending connected device power usage, light sensor readings, and a custom bedside device that sends messages when a button is pressed and is able to play a tune on a piezo buzzer. These messages are sent over MQTT. `off-alarm` also queries InfluxDB that stores the previous light sensor and device power readings to determine whether an audible alarm should be played. Querying InfluxDB is only done when `off-alarm` first starts.

## Install

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run dev
```

```bash
bun run prod
```

### Runtime environment variables for debugging

#### Use fake sensor data

```bash
bunx cross-env USE_FAKE_SENSORS=Y bun run dev
```

Subscribes to fake sensor topics instead of topics that send real sensor data.
Use with fakeSensorReadingEmittor.ts.

### Emit fake sensor data

```bash
bun src/testSupport/fakeSensorReadingEmittor.ts
```

To make it emit illuminance sensor data where the room is dark:

```bash
bun src/testSupport/fakeSensorReadingEmittor.ts dark
```

To make it emit power use sensor data where the device is active:

```bash
bun src/testSupport/fakeSensorReadingEmittor.ts active
```

#### Enable verbose logging

```bash
bunx cross-env LOG_LEVEL=debug bun run dev
```

Sets log level to debug, the most verbose level. The default is info.

#### Persist sensor data (for debugging)

```bash
bunx cross-env PERSIST_SENSOR_DATA=Y bun run prod
```

Persists received sensor data to sensor.sqlite file.

---

(C) 2025 Hoon Choi
