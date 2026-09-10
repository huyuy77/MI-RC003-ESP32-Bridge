#pragma once

#include <stddef.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/** @brief Initialize NVS (with auto-recovery) and the storage layer. */
esp_err_t config_store_init(void);

/** @brief Write a NUL-terminated string value into an NVS namespace. */
esp_err_t config_store_set_str(const char *ns, const char *key, const char *value);

/**
 * @brief Read a string value. Returns the string length (0 if missing).
 * The output is always NUL-terminated when @p out_len > 0.
 */
size_t config_store_get_str(const char *ns, const char *key, char *out, size_t out_len);

/** @brief Remove a single key from a namespace. */
esp_err_t config_store_erase_key(const char *ns, const char *key);

/** @brief Remove every key in a namespace. */
esp_err_t config_store_erase_ns(const char *ns);

/** @brief Erase the whole NVS partition (factory reset). */
esp_err_t config_store_erase_all(void);

#ifdef __cplusplus
}
#endif
