#include "webusb_transport.h"
#include "app_config.h"
#include "app_log.h"
#include "webusb/webusb_protocol.h"

#include <string.h>
#include <stdlib.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "esp_heap_caps.h"
#include "tusb.h"
#include "class/vendor/vendor_device.h"

typedef struct {
    uint8_t cmd;
    uint16_t len;
    uint8_t  payload[WEBUSB_MAX_PAYLOAD];
} webusb_request_t;

static QueueHandle_t s_req_queue = NULL;
static SemaphoreHandle_t s_rx_mutex = NULL;
static uint8_t *s_rx_acc = NULL;
static size_t s_rx_len = 0;
static uint8_t *s_tx_buf = NULL;   // header + payload sent as one transfer

static void write_all(const uint8_t *data, size_t len)
{
    int retries = 0;
    while (len > 0) {
        uint32_t written = tud_vendor_write(data, len);
        tud_vendor_write_flush();
        if (written == 0) {
            if (++retries > 500) {
                app_log("WEBUSB", "TX stalled (%u bytes left)", (unsigned)len);
                break;
            }
            vTaskDelay(pdMS_TO_TICKS(1));
            continue;
        }
        retries = 0;
        data += written;
        len -= written;
    }
}

bool webusb_transport_send(uint8_t cmd, uint8_t status, const uint8_t *payload, size_t len)
{
    if (!tud_mounted() || !s_tx_buf) {
        app_log("WEBUSB", "TX cmd=0x%02X dropped (not mounted)", cmd);
        return false;
    }
    if (len > WEBUSB_MAX_PAYLOAD) {
        len = WEBUSB_MAX_PAYLOAD;
    }

    // Build the whole frame in one buffer so it is emitted as a single USB
    // transfer (avoids a separate short header packet / ZLP that can confuse
    // the browser's frame reader).
    s_tx_buf[0] = WEBUSB_FRAME_SOF0;
    s_tx_buf[1] = WEBUSB_FRAME_SOF1;
    s_tx_buf[2] = cmd;
    s_tx_buf[3] = status;
    s_tx_buf[4] = (uint8_t)(len & 0xFF);
    s_tx_buf[5] = (uint8_t)((len >> 8) & 0xFF);
    if (len > 0 && payload) {
        memcpy(s_tx_buf + WEBUSB_FRAME_HEADER_LEN, payload, len);
    }

    write_all(s_tx_buf, WEBUSB_FRAME_HEADER_LEN + len);
    app_log("WEBUSB", "TX cmd=0x%02X status=%u len=%u", cmd, status, (unsigned)len);
    return true;
}

static void handle_request(webusb_request_t *req)
{
    uint8_t *resp = (uint8_t *)heap_caps_malloc(WEBUSB_MAX_PAYLOAD, MALLOC_CAP_SPIRAM);
    if (!resp) {
        webusb_transport_send(req->cmd, 3, NULL, 0);
        return;
    }

    uint8_t status = 0;
    size_t resp_len = webusb_protocol_handle(req->cmd, req->payload, req->len,
                                             resp, WEBUSB_MAX_PAYLOAD, &status);
    webusb_transport_send(req->cmd, status, resp, resp_len);
    free(resp);
}

static void webusb_task(void *arg)
{
    (void)arg;
    webusb_request_t *req = NULL;

    while (1) {
        if (xQueueReceive(s_req_queue, &req, portMAX_DELAY) == pdTRUE && req) {
            handle_request(req);
            free(req);
            req = NULL;
        }
    }
}

static void process_rx_bytes(const uint8_t *data, size_t len)
{
    if (!s_rx_mutex || !s_rx_acc) {
        return;
    }
    xSemaphoreTake(s_rx_mutex, portMAX_DELAY);

    if (s_rx_len + len > (WEBUSB_FRAME_HEADER_LEN + WEBUSB_MAX_PAYLOAD)) {
        s_rx_len = 0;
    }
    memcpy(s_rx_acc + s_rx_len, data, len);
    s_rx_len += len;

    size_t offset = 0;
    while (s_rx_len - offset >= WEBUSB_FRAME_HEADER_LEN) {
        const uint8_t *p = s_rx_acc + offset;

        if (p[0] != WEBUSB_FRAME_SOF0 || p[1] != WEBUSB_FRAME_SOF1) {
            offset++;
            continue;
        }

        uint8_t cmd = p[2];
        uint16_t payload_len = (uint16_t)(p[4] | (p[5] << 8));
        if (payload_len > WEBUSB_MAX_PAYLOAD) {
            offset++;
            continue;
        }
        if (s_rx_len - offset < (size_t)(WEBUSB_FRAME_HEADER_LEN + payload_len)) {
            break; // wait for more bytes
        }

        webusb_request_t *req = (webusb_request_t *)heap_caps_malloc(sizeof(webusb_request_t), MALLOC_CAP_SPIRAM);
        if (req) {
            req->cmd = cmd;
            req->len = payload_len;
            if (payload_len) {
                memcpy(req->payload, p + WEBUSB_FRAME_HEADER_LEN, payload_len);
            }
            app_log("WEBUSB", "RX cmd=0x%02X len=%u", cmd, (unsigned)payload_len);
            if (xQueueSend(s_req_queue, &req, 0) != pdTRUE) {
                free(req); // queue full, drop
            }
        }
        offset += WEBUSB_FRAME_HEADER_LEN + payload_len;
    }

    if (offset > 0) {
        size_t remaining = s_rx_len - offset;
        if (remaining > 0) {
            memmove(s_rx_acc, s_rx_acc + offset, remaining);
        }
        s_rx_len = remaining;
    }

    xSemaphoreGive(s_rx_mutex);
}

void webusb_transport_init(void)
{
    s_rx_len = 0;
    s_rx_mutex = xSemaphoreCreateMutex();
    s_req_queue = xQueueCreate(4, sizeof(webusb_request_t *));
    s_rx_acc = (uint8_t *)heap_caps_malloc(WEBUSB_FRAME_HEADER_LEN + WEBUSB_MAX_PAYLOAD,
                                           MALLOC_CAP_SPIRAM);
    s_tx_buf = (uint8_t *)heap_caps_malloc(WEBUSB_FRAME_HEADER_LEN + WEBUSB_MAX_PAYLOAD,
                                           MALLOC_CAP_SPIRAM);
    xTaskCreatePinnedToCore(webusb_task, "webusb", 8192, NULL, 4, NULL, TASK_CORE_USB);
    app_log("WEBUSB", "Transport ready (rx=%s tx=%s)",
            s_rx_acc ? "PSRAM" : "ERR", s_tx_buf ? "PSRAM" : "ERR");
}

// Invoked by TinyUSB whenever data arrives on the vendor OUT endpoint.
// In buffered FIFO mode the callback is delivered with a NULL buffer and the
// bytes must be drained from the vendor FIFO.
void tud_vendor_rx_cb(uint8_t idx, const uint8_t *buffer, uint16_t bufsize)
{
    (void)idx;
    if (buffer && bufsize > 0) {
        process_rx_bytes(buffer, bufsize);
        return;
    }

    uint8_t tmp[128];
    uint32_t n;
    uint32_t total = 0;
    while ((n = tud_vendor_read(tmp, sizeof(tmp))) > 0) {
        process_rx_bytes(tmp, n);
        total += n;
    }
    if (total > 0) {
        app_log("WEBUSB", "OUT %u bytes", (unsigned)total);
    }
}
