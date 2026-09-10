#pragma once

#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

/** @brief Initialize the WebUSB request queue and worker task. */
void webusb_transport_init(void);

/**
 * @brief Send a framed response to the browser over the vendor bulk IN endpoint.
 * @param cmd     Command byte being answered (echoed back).
 * @param status  0 = OK, non-zero = error.
 * @param payload Optional payload bytes.
 * @param len     Payload length.
 */
bool webusb_transport_send(uint8_t cmd, uint8_t status, const uint8_t *payload, size_t len);

#ifdef __cplusplus
}
#endif
