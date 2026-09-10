#pragma once

#include <stdint.h>
#include <stdbool.h>
#include "keymap/key_state_machine.h"

#ifdef __cplusplus
extern "C" {
#endif

/** @brief Initialize the HID bridge (mutex + initial release). */
void hid_bridge_init(void);

bool usb_hid_keyboard_press(uint8_t modifier, uint8_t keycode);
bool usb_hid_keyboard_release(void);
bool usb_hid_keyboard_tap(uint8_t modifier, uint8_t keycode);

bool usb_hid_consumer_press(uint16_t usage_code);
bool usb_hid_consumer_release(void);
bool usb_hid_consumer_tap(uint16_t usage_code);

/** @brief Dispatch a high-level key action produced by the key engine. */
void usb_hid_dispatch_action(const key_action_t *action);

#ifdef __cplusplus
}
#endif
