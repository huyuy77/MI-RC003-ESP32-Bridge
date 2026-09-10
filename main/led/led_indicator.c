#include "led_indicator.h"
#include "app_config.h"

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_timer.h"
#include "led_strip.h"

static led_strip_handle_t s_strip = NULL;

static led_state_t s_current_base_state = LED_STATE_WAIT_CONNECTION;
static led_state_t s_flash_state = LED_STATE_WAIT_CONNECTION;
static int64_t     s_flash_expire_us = 0;
static bool        s_is_flashing = false;

static uint32_t s_layer_color = 0x00FF00;
static bool     s_layer_flash = false;

static void write_pixel(uint8_t r, uint8_t g, uint8_t b)
{
    if (!s_strip) return;
    led_strip_set_pixel(s_strip, 0, r, g, b);
    led_strip_refresh(s_strip);
}

static void update_hardware_led(led_state_t state)
{
    if (s_layer_flash && s_is_flashing) {
        uint8_t r = (uint8_t)(((s_layer_color >> 16) & 0xFF) * 36 / 255);
        uint8_t g = (uint8_t)(((s_layer_color >> 8) & 0xFF) * 36 / 255);
        uint8_t b = (uint8_t)((s_layer_color & 0xFF) * 36 / 255);
        write_pixel(r, g, b);
        return;
    }

    switch (state) {
        case LED_STATE_WAIT_CONNECTION:
            write_pixel(24, 0, 0);
            break;
        case LED_STATE_CONNECTED: {
            uint8_t r = (uint8_t)(((s_layer_color >> 16) & 0xFF) * 20 / 255);
            uint8_t g = (uint8_t)(((s_layer_color >> 8) & 0xFF) * 20 / 255);
            uint8_t b = (uint8_t)((s_layer_color & 0xFF) * 20 / 255);
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

static void led_task(void *arg)
{
    (void)arg;
    while (1) {
        if (s_is_flashing) {
            if (esp_timer_get_time() > s_flash_expire_us) {
                s_is_flashing = false;
                update_hardware_led(s_current_base_state);
            } else {
                update_hardware_led(s_flash_state);
            }
        } else {
            update_hardware_led(s_current_base_state);
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

    update_hardware_led(LED_STATE_WAIT_CONNECTION);
    xTaskCreatePinnedToCore(led_task, "led_task", 3072, NULL, 1, NULL, 1);
}

void led_indicator_set(led_state_t state)
{
    if (state == LED_STATE_HID_KEY_PRESS || state == LED_STATE_MIC_KEY_PRESS) return;
    s_is_flashing = false;
    s_current_base_state = state;
    update_hardware_led(state);
}

void led_indicator_trigger_key(bool is_voice_key)
{
    s_layer_flash = false;
    s_flash_state = is_voice_key ? LED_STATE_MIC_KEY_PRESS : LED_STATE_HID_KEY_PRESS;
    s_flash_expire_us = esp_timer_get_time() + 100 * 1000;
    s_is_flashing = true;
}

void led_indicator_set_layer_color(uint32_t rgb_color)
{
    s_layer_color = (rgb_color == 0) ? 0x00FF00 : rgb_color;
    s_layer_flash = true;
    s_flash_expire_us = esp_timer_get_time() + 200 * 1000;
    s_is_flashing = true;
}
