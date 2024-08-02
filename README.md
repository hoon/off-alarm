# off-alarm

## Work in progress

## Purpose

`off-alarm` intends to monitor if a critical device has been inadverdently turned off and alert user using audible alarm. It monitors messages from Tasmota nodes sending connected device power usage, light sensor readings, and a custom Arduino device that sends messages when a button is pressed and is able to play a tune on a piezo buzzer. These messages are sent over MQTT. `off-alarm` also queries InfluxDB that stores the previous light sensor and device power readings to determine whether an audible alarm should be played. Querying InfluxDB is only done when `off-alarm` first starts.

## install

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

---

(C) 2024 Hoon Choi
