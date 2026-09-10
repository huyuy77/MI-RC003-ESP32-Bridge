#pragma once

#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

/** @brief Install the TinyUSB composite device (UAC mic + HID + WebUSB). */
bool usb_composite_init(void);

/** @brief Periodic USB housekeeping. */
void usb_composite_task(void);

/** @brief True once the device is enumerated by the host. */
bool usb_composite_is_mounted(void);

#ifdef __cplusplus
}
#endif
