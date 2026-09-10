#pragma once

#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Initialize the in-RAM log ring buffer.
 */
void app_log_init(void);

/**
 * @brief Append a timestamped line to the log (also forwarded to the UART console).
 */
void app_log(const char *tag, const char *format, ...);

/**
 * @brief Serialize the most recent log lines as a JSON document.
 *
 * The result is written into @p out (always NUL-terminated). Returns the number
 * of bytes written excluding the terminator, or 0 on error.
 */
size_t app_log_get_json(char *out, size_t out_len);

/**
 * @brief Drop all buffered log lines.
 */
void app_log_clear(void);

#ifdef __cplusplus
}
#endif
