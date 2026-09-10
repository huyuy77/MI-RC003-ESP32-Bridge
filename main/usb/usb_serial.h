#pragma once

#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

/** @brief Initialize the CDC debug console. */
void usb_serial_init(void);

/** @brief Best-effort write of a NUL-terminated string to the CDC port. */
void usb_serial_write(const char *s);

/** @brief True when the host has opened the CDC port. */
bool usb_serial_connected(void);

#ifdef __cplusplus
}
#endif
