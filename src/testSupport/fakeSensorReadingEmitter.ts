import mqtt from 'mqtt'
// Power use (every 30 seconds)
//{"StatusSNS":{"Time":"2025-07-04T23:23:09","ENERGY":{"TotalStartTime":"2021-08-01T20:07:29","Total":284.509,"Yesterday":0.086,"Today":0.132,"Power":2,"ApparentPower":6,"ReactivePower":6,"Factor":0.36,"Voltage":122,"Current":0.052}}}
// Illuminance (every 15 seconds)
//{"StatusSNS":{"Time":"2025-07-04T23:23:55","BME280":{"Temperature":27.3,"Humidity":47.0,"DewPoint":15.0,"Pressure":978.9},"TSL2561":{"Illuminance":46.280,"IR":2102,"Broadband":4632},"PressureUnit":"hPa","TempUnit":"C"}}

const FAKE_POWER_TOPIC = 'stat/fake_power/STATUS8'
const FAKE_ILLUMINANCE_TOPIC = 'stat/fake_illuminance/STATUS8'

async function main() {
  const mqttClient = await mqtt.connectAsync(process.env.MQTT_SERVER_URI!, {
    username: process.env.MQTT_USERNAME!,
    password: process.env.MQTT_PASSWORD!,
    reconnectPeriod: 1000,
    reconnectOnConnackError: true,
  })

  setInterval(async () => {
    const payload = {
      StatusSNS: {
        Time: new Date().toISOString(),
        ENERGY: {
          TotalStartTime: '2021-08-01T20:07:29',
          Total: 284.509,
          Yesterday: 0.086,
          Today: 0.132,
          Power: process.argv.includes('active')
            ? Math.round(5 + Math.random() * 3)
            : Math.round(2 + Math.random() * 0.7),
          ApparentPower: 6,
          ReactivePower: 6,
          Factor: 0.36,
          Voltage: 122,
          Current: 0.052,
        },
      },
    }
    await mqttClient.publishAsync(
      FAKE_POWER_TOPIC,
      JSON.stringify(payload),
    )
    console.log(`Published ${JSON.stringify(payload)}`)
  }, 30 * 1000)

  setInterval(async () => {
    const payload = {
      StatusSNS: {
        Time: new Date().toISOString(),
        BME280: {
          Temperature: 27.3,
          Humidity: 47.0,
          DewPoint: 15.0,
          Pressure: 978.9,
        },
        TSL2561: {
          Illuminance: process.argv.includes('dark') ? 0 : 52.28,
          IR: 2102,
          Broadband: 4632,
        },
        PressureUnit: 'hPa',
        TempUnit: 'C',
      },
    }
    await mqttClient.publishAsync(
      FAKE_ILLUMINANCE_TOPIC,
      JSON.stringify(payload),
    )
    console.log(`Published ${JSON.stringify(payload)}`)
  }, 15 * 1000)
}

if (require.main === module) {
  main()
}
