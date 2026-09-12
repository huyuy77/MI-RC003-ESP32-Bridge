#include "app_log.h"

#include <stdarg.h>
#include <stdio.h>
#include <string.h>
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"

#define LOG_LINES        128
#define LOG_LINE_MAX_LEN 256
#define LOG_JSON_LINES   64   // newest lines emitted through WebUSB

static char s_log_lines[LOG_LINES][LOG_LINE_MAX_LEN];
static volatile size_t s_log_head = 0;
static volatile size_t s_log_count = 0;
static portMUX_TYPE s_log_mux = portMUX_INITIALIZER_UNLOCKED;

void app_log_init(void)
{
    s_log_head = 0;
    s_log_count = 0;
    memset(s_log_lines, 0, sizeof(s_log_lines));
}

void app_log(const char *tag, const char *format, ...)
{
    char msg[192];
    va_list args;
    va_start(args, format);
    vsnprintf(msg, sizeof(msg), format, args);
    va_end(args);

    uint64_t now_ms = (uint64_t)(esp_timer_get_time() / 1000);
    char line[LOG_LINE_MAX_LEN];
    snprintf(line, sizeof(line), "[%04llu.%03llu] [%s] %s",
             (unsigned long long)(now_ms / 1000), (unsigned long long)(now_ms % 1000),
             tag, msg);

    // Console output (kept at INFO so it is visible with default log level).
    ESP_LOGI(tag, "%s", msg);

    portENTER_CRITICAL(&s_log_mux);
    strncpy(s_log_lines[s_log_head], line, LOG_LINE_MAX_LEN - 1);
    s_log_lines[s_log_head][LOG_LINE_MAX_LEN - 1] = '\0';
    s_log_head = (s_log_head + 1) % LOG_LINES;
    if (s_log_count < LOG_LINES) {
        s_log_count++;
    }
    portEXIT_CRITICAL(&s_log_mux);
}

static size_t json_escape(char *dst, size_t dst_len, const char *src)
{
    size_t o = 0;
    for (const char *p = src; *p && o + 2 < dst_len; p++) {
        unsigned char c = (unsigned char)*p;
        if (c == '"' || c == '\\') {
            dst[o++] = '\\';
            dst[o++] = (char)c;
        } else if (c == '\n') {
            dst[o++] = '\\';
            dst[o++] = 'n';
        } else if (c == '\r') {
            dst[o++] = '\\';
            dst[o++] = 'r';
        } else if (c == '\t') {
            dst[o++] = '\\';
            dst[o++] = 't';
        } else if (c < 0x20) {
            // Drop other control characters.
            dst[o++] = ' ';
        } else {
            dst[o++] = (char)c;
        }
    }
    dst[o] = '\0';
    return o;
}

size_t app_log_get_json(char *out, size_t out_len)
{
    if (!out || out_len < 16) {
        return 0;
    }

    size_t written = 0;
    written += (size_t)snprintf(out + written, out_len - written, "{\"logs\":[");

    portENTER_CRITICAL(&s_log_mux);
    size_t count = s_log_count;
    size_t start = (count < LOG_LINES) ? 0 : s_log_head;
    if (count > LOG_JSON_LINES) {
        start = (start + (count - LOG_JSON_LINES)) % LOG_LINES;
        count = LOG_JSON_LINES;
    }
    for (size_t i = 0; i < count && written + 8 < out_len; i++) {
        size_t idx = (start + i) % LOG_LINES;
        char escaped[LOG_LINE_MAX_LEN * 2];
        json_escape(escaped, sizeof(escaped), s_log_lines[idx]);
        written += (size_t)snprintf(out + written, out_len - written,
                                    "%s\"%s\"", (i == 0) ? "" : ",", escaped);
    }
    portEXIT_CRITICAL(&s_log_mux);

    if (written + 4 < out_len) {
        written += (size_t)snprintf(out + written, out_len - written, "]}");
    }
    return written;
}

void app_log_clear(void)
{
    portENTER_CRITICAL(&s_log_mux);
    s_log_head = 0;
    s_log_count = 0;
    portEXIT_CRITICAL(&s_log_mux);
}
