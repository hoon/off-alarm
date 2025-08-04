#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "driver/gpio.h"
#include "esp_log.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_timer.h"
#include "nvs_flash.h"
#include "mqtt_client.h"
#include "driver/ledc.h"
#include "sdkconfig.h"

static const char *TAG = "OFF_ALARM";

// WiFi configuration
#define WIFI_SSID CONFIG_WIFI_SSID
#define WIFI_PASSWORD CONFIG_WIFI_PASSWORD

// MQTT configuration
#define MQTT_BROKER_URI CONFIG_MQTT_BROKER_URI
#define MQTT_USERNAME CONFIG_MQTT_USERNAME
#define MQTT_PASSWORD CONFIG_MQTT_PASSWORD

// MQTT topics
#define EVENT_TOPIC CONFIG_EVENT_TOPIC
#define COMMAND_TOPIC CONFIG_COMMAND_TOPIC

// MQTT message field max length
#define MY_MQTT_MSG_FIELD_MAX_CHARS 32

// GPIO configuration
#define BUTTON1_GPIO CONFIG_BUTTON1_GPIO
#define BUTTON2_GPIO CONFIG_BUTTON2_GPIO
#define BUTTON3_GPIO CONFIG_BUTTON3_GPIO
#define BUTTON4_GPIO CONFIG_BUTTON4_GPIO
#define BUZZER_GPIO CONFIG_BUZZER_GPIO

// Button debounce time in milliseconds
#define DEBOUNCE_TIME 1000

// LEDC configuration for buzzer
#define LEDC_TIMER LEDC_TIMER_0
#define LEDC_MODE LEDC_LOW_SPEED_MODE
#define LEDC_CHANNEL LEDC_CHANNEL_0
#define LEDC_DUTY_RES LEDC_TIMER_13_BIT // 13-bit resolution
#define LEDC_FREQUENCY 5000             // 5 kHz
#define LEDC_DUTY 4095                  // 50% duty cycle (2^13 / 2 - 1)

// Define pause between tunes in milliseconds
#define TUNE_PAUSE_MS 500

// BPM (Beats Per Minute) for tune playback
#define DEFAULT_BPM 120

// Note definitions (frequencies in Hz)
typedef enum {
    NOTE_REST = 0,  // Rest (no sound)
    NOTE_C  = 1,
    NOTE_CS = 2,    // C sharp
    NOTE_D  = 3,
    NOTE_DS = 4,    // D sharp
    NOTE_E  = 5,
    NOTE_F  = 6,
    NOTE_FS = 7,    // F sharp
    NOTE_G  = 8,
    NOTE_GS = 9,    // G sharp
    NOTE_A  = 10,
    NOTE_AS = 11,   // A sharp
    NOTE_B  = 12
} note_t;

// Note duration definitions
typedef enum {
    DURATION_WHOLE = 1,
    DURATION_HALF = 2,
    DURATION_QUARTER = 4,
    DURATION_EIGHTH = 8,
    DURATION_SIXTEENTH = 16
} note_duration_t;

// Musical note structure
typedef struct {
    note_t note;            // The note (C, D, E, etc.)
    uint8_t octave;         // Octave (0-8)
    note_duration_t duration; // Duration of the note
} musical_note_t;

// Button state structure
typedef struct {
    uint8_t gpio_num;
    uint8_t button_id;
    int64_t last_press_time;
    uint8_t tune_id;
    char mqtt_msg[32];
} button_config_t;

// Buzzer tune structure
typedef struct {
    musical_note_t notes[64];
    uint8_t length;
    uint16_t bpm;           // Beats per minute
} tune_t;

// Global variables
static esp_mqtt_client_handle_t mqtt_client = NULL;
static QueueHandle_t button_evt_queue = NULL;
static QueueHandle_t tune_queue = NULL;  // Queue for tune playback

// Button configurations
static button_config_t buttons[] = {
    {BUTTON1_GPIO, 1, 0, 0, "in_bed"},
    {BUTTON2_GPIO, 2, 0, 2, "awake"},
    {BUTTON3_GPIO, 3, 0, 4, "up_from_bed"},
    {BUTTON4_GPIO, 4, 0, 6, "check_status"}
};

// Buzzer tunes with musical notation
static tune_t tunes[] = {
    // Tune 0: Button 1 press
    {
        .notes = {{NOTE_C, 3, DURATION_QUARTER}, {NOTE_G, 3, DURATION_QUARTER}},
        .length = 2,
        .bpm = DEFAULT_BPM
    },
    // Tune 1: Button 1 press confirm
    {
        .notes = {{NOTE_G, 3, DURATION_EIGHTH}, {NOTE_C, 3, DURATION_EIGHTH}},
        .length = 2,
        .bpm = DEFAULT_BPM
    },
    // Tune 2: Button 2 press
    {
        .notes = {{NOTE_C, 4, 8}, {NOTE_D, 4, 8}, {NOTE_E, 4, 8}},
        .length = 3,
        .bpm = DEFAULT_BPM
    },
    // Tune 3: Button 2 press
    {
        .notes = {{NOTE_E, 4, 16}, {NOTE_D, 4, 16}, {NOTE_C, 4, 16}},
        .length = 3,
        .bpm = DEFAULT_BPM
    },
    // Tune 4: Button 3 press
    {
        .notes = {{NOTE_A, 3, 8}, {NOTE_C, 3, 8}, {NOTE_E, 3, 8}, {NOTE_G, 3, 8}},
        .length = 4,
        .bpm = DEFAULT_BPM
    },
    // Tune 5: Button 3 press confirm
    {
        .notes = {{NOTE_G, 3, 16}, {NOTE_E, 3, 16}, {NOTE_C, 3, 16}, {NOTE_A, 3, 16}},
        .length = 4,
        .bpm = DEFAULT_BPM
    },
    // Tune 6: Button 4 press
    { 
        .notes = {{NOTE_FS, 5, 8}, {NOTE_GS, 5, 8}, {NOTE_AS, 6, 8}, {NOTE_CS, 6, 8}, {NOTE_B, 6, 4}},
        .length = 5,
        .bpm = DEFAULT_BPM
    }, 
    // Tune 7: Reveille
    {
        .notes = {
            {NOTE_C, 5, DURATION_EIGHTH},
            {NOTE_E, 5, DURATION_EIGHTH},
            {NOTE_G, 5, DURATION_EIGHTH},
            {NOTE_C, 6, DURATION_EIGHTH},
            {NOTE_G, 5, DURATION_EIGHTH},
            {NOTE_E, 5, DURATION_EIGHTH},
            {NOTE_F, 5, DURATION_EIGHTH},
            {NOTE_A, 5, DURATION_EIGHTH},
            {NOTE_C, 6, DURATION_EIGHTH},
            {NOTE_A, 5, DURATION_EIGHTH},
            {NOTE_F, 5, DURATION_EIGHTH},
            {NOTE_D, 5, DURATION_EIGHTH},
            {NOTE_G, 5, DURATION_EIGHTH},
            {NOTE_B, 5, DURATION_EIGHTH},
            {NOTE_D, 6, DURATION_EIGHTH},
            {NOTE_G, 5, DURATION_EIGHTH},
            {NOTE_F, 5, DURATION_EIGHTH},
            {NOTE_D, 5, DURATION_EIGHTH},
            {NOTE_E, 5, DURATION_EIGHTH},
            {NOTE_G, 5, DURATION_EIGHTH},
            {NOTE_C, 6, DURATION_EIGHTH},
            {NOTE_E, 6, DURATION_EIGHTH},
            {NOTE_D, 6, DURATION_EIGHTH},
            {NOTE_C, 6, DURATION_EIGHTH},
            {NOTE_A, 5, DURATION_EIGHTH},
            {NOTE_F, 5, DURATION_EIGHTH},
            {NOTE_D, 5, DURATION_EIGHTH},
            {NOTE_F, 5, DURATION_EIGHTH},
            {NOTE_E, 5, DURATION_EIGHTH},
            {NOTE_C, 5, DURATION_EIGHTH},
            {NOTE_G, 5, DURATION_QUARTER},
            {NOTE_E, 5, DURATION_EIGHTH},
            {NOTE_C, 5, DURATION_QUARTER},
            {NOTE_REST, 0, DURATION_EIGHTH},
            {NOTE_C, 6, DURATION_QUARTER},
            {NOTE_REST, 0, DURATION_EIGHTH},
        },
        .length = 36,
        .bpm = DEFAULT_BPM
    },
    // Tune 8: Failure tone #1
    { 
        .notes = {
            {NOTE_GS, 5, 8},
            {NOTE_REST, 0, 32},
            {NOTE_GS, 5, 8},
            {NOTE_REST, 0, 32},
            {NOTE_GS, 5, 8},
        },
        .length = 5,
        .bpm = DEFAULT_BPM
    }, 
};

// Function prototypes
static void wifi_init(void);
static void mqtt_app_start(void);
static void button_init(void);
static void buzzer_init(void);
static void play_tune(int tune_id);
static void button_task(void *arg);
static void tune_player_task(void *arg);  // New task for playing tunes
static void mqtt_event_handler(void *handler_args, esp_event_base_t base, int32_t event_id, void *event_data);
static uint16_t note_to_frequency(note_t note, uint8_t octave);
static uint32_t calculate_duration_ms(note_duration_t duration, uint16_t bpm);

// WiFi event handler
static void wifi_event_handler(void *arg, esp_event_base_t event_base,
                              int32_t event_id, void *event_data)
{
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        ESP_LOGI(TAG, "Retry connecting to the AP");
        esp_wifi_connect();
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *event = (ip_event_got_ip_t*) event_data;
        ESP_LOGI(TAG, "Got IP: " IPSTR, IP2STR(&event->ip_info.ip));
        mqtt_app_start();
    }
}

// Initialize WiFi
static void wifi_init(void)
{
    ESP_LOGI(TAG, "Initializing WiFi");
    
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));

    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &wifi_event_handler, NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &wifi_event_handler, NULL));

    wifi_config_t wifi_config = {
        .sta = {
            .ssid = WIFI_SSID,
            .password = WIFI_PASSWORD,
        },
    };
    
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(ESP_IF_WIFI_STA, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());

    ESP_LOGI(TAG, "WiFi initialization finished");
}

enum MyMqttAck {
  MY_MQTT_OK = 0,
  MY_MQTT_FAIL = 1,
  MY_MQTT_UNDEFINED = 2
};

struct MyMqttMsg {
  char n[MY_MQTT_MSG_FIELD_MAX_CHARS];
  char r[MY_MQTT_MSG_FIELD_MAX_CHARS];
  char p[MY_MQTT_MSG_FIELD_MAX_CHARS];
  enum MyMqttAck a;
};

// MQTT message struct initializer
int init_mqtt_msg(struct MyMqttMsg *msg)
{
    msg->n[0] = '\0';
    msg->r[0] = '\0';
    msg->p[0] = '\0';
    msg->a = MY_MQTT_UNDEFINED;
    return 0;
}

// MQTT message parser
int parse_mqtt_msg(char *msgStr, struct MyMqttMsg *parsedMsg)
{
    // Message spec:
    // n=<any alphanumeric sequence up to 29 char in length>
    // r=<any alphanumeric sequence up to 29 char in length>
    // p=<any alphanumeric sequence up to 29 char in length>
    // a=<ok,fail>
    //
    // n - arbitrary reference sequence for a new command, e.g. "playTone"
    // r - response to a command that was issued with a reference sequence
    // p - additional information for command in 'n' or information 
    //     requested previous command being returned with 'r'
    // a - acknowledgement - either 'ok' or 'fail', only used with response msg
    const int KEY_ARRAY_LENGTH = 3;
    char key[3][2] = { "n", "r", "p" };
    char *field[3] = { parsedMsg->n, parsedMsg->r, parsedMsg->p };

    char *dupStr = strdup(msgStr);
    if (dupStr == NULL) {
        return -1; // Memory allocation failed
    }

    char *scToken;
    char *semicolon = ";";
    char *eqsign = "=";

    while ((scToken = strsep(&dupStr, semicolon)) != NULL) {
        char *scDupStr = strdup(scToken);
        if (scDupStr == NULL) {
            free(dupStr); // Free the original duplicated string before returning
            return -1; // Memory allocation failed
        }
        
        char *strToSepOnEq = scDupStr;
        char *keyToken = strsep(&strToSepOnEq, eqsign);
        char *valToken = strToSepOnEq;

        if (keyToken == NULL || valToken == NULL) {
            free(scDupStr);
            continue;
        }

        for (int i = 0; i < KEY_ARRAY_LENGTH; i++) {
            if (strcmp(keyToken, key[i]) == 0) {
                int valTokenLength = strlen(valToken);
                if (valTokenLength >= (MY_MQTT_MSG_FIELD_MAX_CHARS - 1)) {
                    strncpy(field[i], valToken, MY_MQTT_MSG_FIELD_MAX_CHARS - 1);
                    field[i][MY_MQTT_MSG_FIELD_MAX_CHARS - 1] = '\0';
                } else {
                    strcpy(field[i], valToken);
                }
            }
        }

        if (strcmp(keyToken, "a") == 0) {
            if (strcmp(valToken, "ok") == 0) {
                parsedMsg->a = MY_MQTT_OK;
            } else if (strcmp(valToken, "fail") == 0) {
                parsedMsg->a = MY_MQTT_FAIL;
            } else {
                parsedMsg->a = MY_MQTT_UNDEFINED;
            }
        }

        free(scDupStr);
    }

    free(dupStr);

    return 0;
}

// MQTT event handler
static void mqtt_event_handler(void *handler_args, esp_event_base_t base, int32_t event_id, void *event_data)
{
    esp_mqtt_event_handle_t event = event_data;
    
    switch ((esp_mqtt_event_id_t)event_id) {
        case MQTT_EVENT_CONNECTED:
            ESP_LOGI(TAG, "MQTT_EVENT_CONNECTED");
            // Subscribe to command topic
            esp_mqtt_client_subscribe_single(mqtt_client, COMMAND_TOPIC, 0);
            break;
            
        case MQTT_EVENT_DISCONNECTED:
            ESP_LOGI(TAG, "MQTT_EVENT_DISCONNECTED");
            break;
            
        case MQTT_EVENT_SUBSCRIBED:
            ESP_LOGI(TAG, "MQTT_EVENT_SUBSCRIBED, msg_id=%d", event->msg_id);
            break;
            
        case MQTT_EVENT_UNSUBSCRIBED:
            ESP_LOGI(TAG, "MQTT_EVENT_UNSUBSCRIBED, msg_id=%d", event->msg_id);
            break;
            
        case MQTT_EVENT_PUBLISHED:
            ESP_LOGI(TAG, "MQTT_EVENT_PUBLISHED, msg_id=%d", event->msg_id);
            break;
            
        case MQTT_EVENT_DATA:
            ESP_LOGI(TAG, "MQTT_EVENT_DATA");
            ESP_LOGI(TAG, "TOPIC=%.*s", event->topic_len, event->topic);
            ESP_LOGI(TAG, "DATA=%.*s", event->data_len, event->data);
            
            // Check if message is for command topic
            if (strncmp(event->topic, COMMAND_TOPIC, event->topic_len) == 0) {
                // Parse the tune ID from the message
                char tune_str[10] = {0};
                memcpy(tune_str, event->data, event->data_len < 9 ? event->data_len : 9);

                struct MyMqttMsg parsedMsg;
                init_mqtt_msg(&parsedMsg);
                
                // Create a null-terminated copy of the MQTT data
                char *mqtt_data = malloc(event->data_len + 1);
                if (mqtt_data != NULL) {
                    memcpy(mqtt_data, event->data, event->data_len);
                    mqtt_data[event->data_len] = '\0';  // Ensure null-termination
                    
                    // Parse the MQTT message
                    parse_mqtt_msg(mqtt_data, &parsedMsg);
                    
                    // If parsed command is 'playTone'
                    if (strcmp(parsedMsg.n, "playTone") == 0) {
                        int tune_id = atoi(parsedMsg.p); // get tune_id from parsed argument
                        if (tune_id >= 0) {
                            if (xQueueSend(tune_queue, &tune_id, 0) == pdTRUE) {
                                ESP_LOGI(TAG, "Command 'playTone': Enqueued tune %d", tune_id);
                            } else {
                                ESP_LOGW(TAG, "Command 'playTone': Queue is full, dropping tune %d", tune_id);
                            }
                        }
                    }
                }
                // Free the allocated memory
                free(mqtt_data);
            }
            break;
            
        case MQTT_EVENT_ERROR:
            ESP_LOGI(TAG, "MQTT_EVENT_ERROR");
            break;
            
        default:
            ESP_LOGI(TAG, "Other event id:%d", event->event_id);
            break;
    }
}

// Start MQTT client
static void mqtt_app_start(void)
{
    ESP_LOGI(TAG, "Starting MQTT client");
    
    esp_mqtt_client_config_t mqtt_cfg = {
        .broker = {
            .address = {
                .uri = MQTT_BROKER_URI,
            },
        },
        .credentials = {
            .username = MQTT_USERNAME,
            .authentication = {
                .password = MQTT_PASSWORD,
            },
        },
    };
    
    mqtt_client = esp_mqtt_client_init(&mqtt_cfg);
    esp_mqtt_client_register_event(mqtt_client, ESP_EVENT_ANY_ID, mqtt_event_handler, NULL);
    esp_mqtt_client_start(mqtt_client);
}

// Button ISR handler
static void IRAM_ATTR button_isr_handler(void *arg)
{
    button_config_t *btn = (button_config_t *)arg;
    int64_t current_time = esp_timer_get_time() / 1000; // Convert to milliseconds
    
    // Simple debounce
    if ((current_time - btn->last_press_time) > DEBOUNCE_TIME) {
        btn->last_press_time = current_time;
        // Use BaseType_t for the ISR version of queue send
        BaseType_t xHigherPriorityTaskWoken = pdFALSE;
        xQueueSendFromISR(button_evt_queue, &btn->button_id, &xHigherPriorityTaskWoken);
        // Yield if a higher priority task was woken
        if (xHigherPriorityTaskWoken == pdTRUE) {
            portYIELD_FROM_ISR();
        }
    }
}

// Initialize buttons
static void button_init(void)
{
    ESP_LOGI(TAG, "Initializing buttons");
    
    // Create a queue to handle button events
    button_evt_queue = xQueueCreate(10, sizeof(uint8_t));
    
    // Configure button GPIOs
    gpio_config_t io_conf = {
        .intr_type = GPIO_INTR_NEGEDGE,    // Interrupt on falling edge
        .mode = GPIO_MODE_INPUT,           // Input mode
        .pin_bit_mask = 0,                 // Will be set for each button
        .pull_up_en = 1,                   // Enable pull-up
        .pull_down_en = 0,                 // Disable pull-down
    };
    
    
    // Install GPIO ISR service
    gpio_install_isr_service(0);

    // Configure each button
    for (int i = 0; i < sizeof(buttons) / sizeof(buttons[0]); i++) {
        io_conf.pin_bit_mask = (1ULL << buttons[i].gpio_num);
        gpio_config(&io_conf);
        
        // Hook ISR handler for specific GPIO pin
        gpio_isr_handler_add(buttons[i].gpio_num, button_isr_handler, &buttons[i]);
    }
    
    // Start button task
    xTaskCreate(button_task, "button_task", 4096, NULL, 10, NULL);
}

// Initialize buzzer
static void buzzer_init(void)
{
    ESP_LOGI(TAG, "Initializing buzzer");
    
    // Create tune queue
    tune_queue = xQueueCreate(10, sizeof(int));
    if (tune_queue == NULL) {
        ESP_LOGE(TAG, "Failed to create tune queue");
        return;
    }
    
    // Start tune player task
    xTaskCreate(tune_player_task, "tune_player", 4096, NULL, 5, NULL);
    
    // Configure LEDC timer for buzzer
    ledc_timer_config_t ledc_timer = {
        .duty_resolution = LEDC_DUTY_RES,
        .freq_hz = LEDC_FREQUENCY,
        .speed_mode = LEDC_MODE,
        .timer_num = LEDC_TIMER,
        .clk_cfg = LEDC_AUTO_CLK,
    };
    ledc_timer_config(&ledc_timer);
    
    // Configure LEDC channel for buzzer
    ledc_channel_config_t ledc_channel = {
        .channel = LEDC_CHANNEL,
        .duty = 0,
        .gpio_num = BUZZER_GPIO,
        .speed_mode = LEDC_MODE,
        .hpoint = 0,
        .timer_sel = LEDC_TIMER,
    };
    ledc_channel_config(&ledc_channel);
}

// Calculate frequency for a given note and octave
static uint16_t note_to_frequency(note_t note, uint8_t octave)
{
    // Return 0 for rest
    if (note == NOTE_REST) {
        return 0;
    }
    
    // Base frequencies for notes in octave 4
    static const float base_freq[] = {
        0,      // Rest
        261.63, // C
        277.18, // C#
        293.66, // D
        311.13, // D#
        329.63, // E
        349.23, // F
        369.99, // F#
        392.00, // G
        415.30, // G#
        440.00, // A
        466.16, // A#
        493.88  // B
    };
    
    // Calculate frequency based on note and octave
    // Formula: frequency = base_frequency * 2^(octave-4)
    float freq = base_freq[note];
    
    // Adjust for octave (base frequencies are for octave 4)
    if (octave > 4) {
        for (int i = 0; i < (octave - 4); i++) {
            freq *= 2.0;
        }
    } else if (octave < 4) {
        for (int i = 0; i < (4 - octave); i++) {
            freq /= 2.0;
        }
    }
    
    return (uint16_t)freq;
}

// Calculate duration in milliseconds for a note based on BPM
static uint32_t calculate_duration_ms(note_duration_t duration, uint16_t bpm)
{
    // Calculate duration of a whole note in milliseconds
    // Formula: whole_note_duration = (60 seconds / BPM) * 4 beats * 1000 ms
    uint32_t whole_note_ms = (60 * 4 * 1000) / bpm;
    
    // Calculate actual duration based on note type
    return whole_note_ms / duration;
}

// Play a tune on the buzzer
static void play_tune(int tune_id)
{
    if (tune_id < 0 || tune_id >= sizeof(tunes) / sizeof(tunes[0])) {
        ESP_LOGE(TAG, "Invalid tune ID: %d", tune_id);
        return;
    }
    
    tune_t *tune = &tunes[tune_id];
    
    ESP_LOGI(TAG, "Playing tune %d (BPM: %d)", tune_id, tune->bpm);
    
    for (int i = 0; i < tune->length; i++) {
        musical_note_t *note = &tune->notes[i];
        uint16_t freq = note_to_frequency(note->note, note->octave);
        uint32_t duration_ms = calculate_duration_ms(note->duration, tune->bpm);
        
        ESP_LOGD(TAG, "Note: %d, Octave: %u, Freq: %u Hz, Duration: %lu ms", 
                note->note, note->octave, freq, duration_ms);
        
        if (freq > 0) {
            // Set frequency and start buzzer
            ledc_set_freq(LEDC_MODE, LEDC_TIMER, freq);
            ledc_set_duty(LEDC_MODE, LEDC_CHANNEL, LEDC_DUTY);
            ledc_update_duty(LEDC_MODE, LEDC_CHANNEL);
        } else {
            // Stop buzzer for rest
            ledc_set_duty(LEDC_MODE, LEDC_CHANNEL, 0);
            ledc_update_duty(LEDC_MODE, LEDC_CHANNEL);
        }
        
        // Wait for note duration
        vTaskDelay(duration_ms / portTICK_PERIOD_MS);
    }
    
    // Ensure buzzer is off when tune is finished
    ledc_set_duty(LEDC_MODE, LEDC_CHANNEL, 0);
    ledc_update_duty(LEDC_MODE, LEDC_CHANNEL);
}

// Button task to handle button presses
static void button_task(void *arg)
{
    uint8_t button_id;
    // char msg[32];
    
    for (;;) {
        if (xQueueReceive(button_evt_queue, &button_id, portMAX_DELAY)) {
            ESP_LOGI(TAG, "Button %d pressed", button_id);
            
            // Publish message to MQTT broker
            int ret = -1;
            if (mqtt_client) {
                ret = esp_mqtt_client_enqueue(
                    mqtt_client,
                    EVENT_TOPIC,
                    buttons[button_id - 1].mqtt_msg,
                    0,
                    1,
                    0,
                    pdFALSE
                );
                if (ret > -1) {
                    ESP_LOGI(
                        TAG,
                        "Enqueued MQTT message to be published: \"%s\", msg_id: %d",
                        buttons[button_id - 1].mqtt_msg,
                        ret
                    );
                } else {
                    ESP_LOGE(
                        TAG,
                        "Failed to enqueue MQTT message: \"%s\", status: %d",
                        buttons[button_id - 1].mqtt_msg,
                        ret
                    );
                }
            } else {
                ESP_LOGI(TAG, "Button pressed but MQTT client not initialized");
            }

            // Failure tone if MQTT publish enqueue fails
            const int tune_id = ret > -1 ? (int)buttons[button_id - 1].tune_id : 8;
            if (xQueueSend(tune_queue, &tune_id, 0) == pdTRUE) {
                ESP_LOGI(TAG, "Button %d, tune %d added to queue", button_id, tune_id);
            } else {
                ESP_LOGI(TAG, "Button %d, tune %d couldn't be added to queue", button_id, tune_id);
            }
        }
    }
}

// Task to play tunes sequentially from the queue
static void tune_player_task(void *arg)
{
    int tune_id;
    
    for (;;) {
        // Wait for a tune in the queue
        if (xQueueReceive(tune_queue, &tune_id, portMAX_DELAY)) {
            // Play the tune
            play_tune(tune_id);
            
            // Pause between tunes
            vTaskDelay(TUNE_PAUSE_MS / portTICK_PERIOD_MS);
        }
    }
}

void app_main(void)
{
    // Initialize NVS
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);
    
    ESP_LOGI(TAG, "ESP32 MQTT Button and Buzzer Example");
    
    // Initialize components
    wifi_init();
    buzzer_init();
    button_init();
}