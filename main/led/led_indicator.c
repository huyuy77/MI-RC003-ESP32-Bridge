#include "led_indicator.h"
#include "app_config.h"

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_timer.h"
#include "led_strip.h"
#include <math.h>

static led_strip_handle_t s_strip = NULL;

// State is written from the BLE and USB tasks and rendered only by led_task.
// The RMT driver is not thread-safe, so all led_strip_* calls must stay on the
// single led_task; concurrent refresh caused "channel not in init state".
static portMUX_TYPE s_led_mux = portMUX_INITIALIZER_UNLOCKED;

static led_state_t s_current_base_state = LED_STATE_WAIT_CONNECTION;
static led_state_t s_flash_state = LED_STATE_WAIT_CONNECTION;
static int64_t     s_flash_expire_us = 0;
static bool        s_is_flashing = false;

// True while the host is receiving at least one pressed HID key/button. This
// tracks the real output state (set on report press, cleared on release)
// instead of flashing once per input event.
static bool s_hid_active = false;

static uint32_t s_layer_color = 0x00FF00;
static bool     s_layer_flash = false;

// Configuration-switch mode: breathe the current configuration colour.
static bool s_switch_mode = false;
#define SWITCH_BREATH_PERIOD_US (1500 * 1000)
#define SWITCH_BREATH_MIN       6
#define SWITCH_BREATH_MAX       40

static void write_pixel(uint8_t r, uint8_t g, uint8_t b)
{
    if (!s_strip) return;
    led_strip_set_pixel(s_strip, 0, r, g, b);
    led_strip_refresh(s_strip);
}

static void render_state(led_state_t state, bool show_layer_color, uint32_t layer_color)
{
    if (show_layer_color) {
        uint8_t r = (uint8_t)(((layer_color >> 16) & 0xFF) * 36 / 255);
        uint8_t g = (uint8_t)(((layer_color >> 8) & 0xFF) * 36 / 255);
        uint8_t b = (uint8_t)((layer_color & 0xFF) * 36 / 255);
        write_pixel(r, g, b);
        return;
    }

    switch (state) {
        case LED_STATE_WAIT_CONNECTION:
            write_pixel(24, 0, 0);
            break;
        case LED_STATE_CONNECTED: {
            uint8_t r = (uint8_t)(((layer_color >> 16) & 0xFF) * 20 / 255);
            uint8_t g = (uint8_t)(((layer_color >> 8) & 0xFF) * 20 / 255);
            uint8_t b = (uint8_t)((layer_color & 0xFF) * 20 / 255);
            write_pixel(r, g, b);
            break;
        }
        case LED_STATE_MIC_STREAMING:
            write_pixel(0, 0, 24);
            break;
        case LED_STATE_HID_KEY_PRESS:
            write_pixel(24, 24, 0);
            break;
        case LED_STATE_MIC_KEY_PRESS:
            write_pixel(24, 0, 0);
            break;
        default:
            write_pixel(0, 0, 0);
            break;
    }
}

// Smoothly breathe the active configuration colour while the switch mode is on.
static void render_breathing(uint32_t layer_color)
{
    uint32_t color = (layer_color == 0) ? 0x00FF00 : layer_color;
    float phase = (float)(esp_timer_get_time() % SWITCH_BREATH_PERIOD_US) /
                  (float)SWITCH_BREATH_PERIOD_US;
    float wave = 0.5f - 0.5f * cosf(2.0f * 3.14159265f * phase);
    float scale = (SWITCH_BREATH_MIN + (SWITCH_BREATH_MAX - SWITCH_BREATH_MIN) * wave) / 255.0f;
    uint8_t r = (uint8_t)(((color >> 16) & 0xFF) * scale);
    uint8_t g = (uint8_t)(((color >> 8) & 0xFF) * scale);
    uint8_t b = (uint8_t)((color & 0xFF) * scale);
    write_pixel(r, g, b);
}

static void led_task(void *arg)
{
    (void)arg;
    while (1) {
        led_state_t state;
        bool show_layer_color;
        uint32_t layer_color;
        bool flashing;
        bool switch_mode;

        portENTER_CRITICAL(&s_led_mux);
        if (s_is_flashing && esp_timer_get_time() > s_flash_expire_us) {
            s_is_flashing = false;
        }
        if (s_is_flashing) {
            state = s_flash_state;
        } else if (s_hid_active) {
            state = LED_STATE_HID_KEY_PRESS;
        } else {
            state = s_current_base_state;
        }
        // Voice streaming keeps priority over the HID-press colour.
        if (!s_is_flashing && s_current_base_state == LED_STATE_MIC_STREAMING) {
            state = LED_STATE_MIC_STREAMING;
        }
        show_layer_color = s_layer_flash && s_is_flashing;
        layer_color = s_layer_color;
        flashing = s_is_flashing;
        switch_mode = s_switch_mode;
        portEXIT_CRITICAL(&s_led_mux);

        if (!flashing && switch_mode) {
            render_breathing(layer_color);
        } else {
            render_state(state, show_layer_color, layer_color);
        }
        vTaskDelay(pdMS_TO_TICKS(20));
    }
}

void led_indicator_init(void)
{
    led_strip_config_t strip_config = {
        .strip_gpio_num = RGB_BUILTIN,
        .max_leds = 1,
        .led_model = LED_MODEL_WS2812,
        .color_component_format = LED_STRIP_COLOR_COMPONENT_FMT_GRB,
        .flags = { .invert_out = false },
    };
    led_strip_rmt_config_t rmt_config = {
        .clk_src = RMT_CLK_SRC_DEFAULT,
        .resolution_hz = 10 * 1000 * 1000,
        .mem_block_symbols = 64,
        .flags = { .with_dma = false },
    };

    if (led_strip_new_rmt_device(&strip_config, &rmt_config, &s_strip) != ESP_OK) {
        s_strip = NULL;
    }

    render_state(LED_STATE_WAIT_CONNECTION, false, s_layer_color);
    xTaskCreatePinnedToCore(led_task, "led_task", 3072, NULL, 1, NULL, 1);
}

void led_indicator_set(led_state_t state)
{
    if (state == LED_STATE_HID_KEY_PRESS || state == LED_STATE_MIC_KEY_PRESS) return;
    portENTER_CRITICAL(&s_led_mux);
    s_is_flashing = false;
    s_current_base_state = state;
    portEXIT_CRITICAL(&s_led_mux);
}

void led_indicator_set_hid_active(bool active)
{
    portENTER_CRITICAL(&s_led_mux);
    s_hid_active = active;
    portEXIT_CRITICAL(&s_led_mux);
}

void led_indicator_set_layer_color(uint32_t rgb_color)
{
    portENTER_CRITICAL(&s_led_mux);
    s_layer_color = (rgb_color == 0) ? 0x00FF00 : rgb_color;
    s_layer_flash = true;
    s_flash_expire_us = esp_timer_get_time() + 200 * 1000;
    s_is_flashing = true;
    portEXIT_CRITICAL(&s_led_mux);
}

void led_indicator_set_switch_mode(bool active)
{
    portENTER_CRITICAL(&s_led_mux);
    s_switch_mode = active;
    portEXIT_CRITICAL(&s_led_mux);
}
