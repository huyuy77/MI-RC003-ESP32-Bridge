#pragma once

#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    LED_STATE_WAIT_CONNECTION = 0, // Red solid
    LED_STATE_CONNECTED,           // Layer color (dim)
    LED_STATE_MIC_STREAMING,       // Blue solid
    LED_STATE_HID_KEY_PRESS,       // Yellow while a HID key/button is held
    LED_STATE_MIC_KEY_PRESS        // Red flash
} led_state_t;

void led_indicator_init(void);
void led_indicator_set(led_state_t state);
/* Hold the LED yellow while the host is receiving a pressed HID key/button.
 * Cleared automatically when every key/button is released. */
void led_indicator_set_hid_active(bool active);
void led_indicator_set_layer_color(uint32_t rgb_color);
/* Breathe the current configuration colour while the switch mode is active. */
void led_indicator_set_switch_mode(bool active);

#ifdef __cplusplus
}
#endif
