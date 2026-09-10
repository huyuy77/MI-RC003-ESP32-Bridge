#include "webusb_transport.h"
#include "app_config.h"
#include "app_log.h"
#include "webusb/webusb_protocol.h"

#include <string.h>
#include <stdlib.h>
#include "esp_heap_caps.h"
#include "tusb.h"
#include "class/vendor/vendor_device.h"

// The WebUSB vendor endpoint is driven entirely from the TinyUSB task context
// (tud_vendor_rx_cb). Requests are parsed and answered synchronously so that
// tud_vendor_write()/flush() are never called from another task, which could
// otherwise race with the stack and eventually stall the endpoint.
static uint8_t *s_rx_acc = NULL;
static size_t   s_rx_len = 0;
static uint8_t *s_tx_buf = NULL;
static uint8_t *s_resp_buf = NULL;

static void write_all(const uint8_t *data, size_t len)
{
    // Responses are smaller than the vendor TX FIFO, so this normally completes
    // in one call without yielding (yielding here would stall tud_task).
    int retries = 0;
    while (len > 0) {
        uint32_t written = tud_vendor_write(data, len);
        tud_vendor_write_flush();
        if (written == 0) {
            if (++retries > 50) {
                app_log("WEBUSB", "TX stalled (%u bytes left)", (unsigned)len);
                break;
            }
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
        return false;
    }
    if (len > WEBUSB_MAX_PAYLOAD) {
        len = WEBUSB_MAX_PAYLOAD;
    }

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
    return true;
}

static void handle_request(uint8_t cmd, const uint8_t *payload, uint16_t payload_len)
{
    if (!s_resp_buf) {
        webusb_transport_send(cmd, 3, NULL, 0);
        return;
    }

    uint8_t status = 0;
    size_t resp_len = webusb_protocol_handle(cmd, payload, payload_len,
                                             s_resp_buf, WEBUSB_MAX_PAYLOAD, &status);
    app_log("WEBUSB", "cmd=0x%02X -> status=%u len=%u", cmd, status, (unsigned)resp_len);
    webusb_transport_send(cmd, status, s_resp_buf, resp_len);
}

static void process_rx_bytes(const uint8_t *data, size_t len)
{
    if (!s_rx_acc) {
        return;
    }

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

        handle_request(cmd, p + WEBUSB_FRAME_HEADER_LEN, payload_len);
        offset += WEBUSB_FRAME_HEADER_LEN + payload_len;
    }

    if (offset > 0) {
        size_t remaining = s_rx_len - offset;
        if (remaining > 0) {
            memmove(s_rx_acc, s_rx_acc + offset, remaining);
        }
        s_rx_len = remaining;
    }
}

void webusb_transport_init(void)
{
    s_rx_len = 0;
    s_rx_acc = (uint8_t *)heap_caps_malloc(WEBUSB_FRAME_HEADER_LEN + WEBUSB_MAX_PAYLOAD,
                                           MALLOC_CAP_SPIRAM);
    s_tx_buf = (uint8_t *)heap_caps_malloc(WEBUSB_FRAME_HEADER_LEN + WEBUSB_MAX_PAYLOAD,
                                           MALLOC_CAP_SPIRAM);
    s_resp_buf = (uint8_t *)heap_caps_malloc(WEBUSB_MAX_PAYLOAD, MALLOC_CAP_SPIRAM);
    app_log("WEBUSB", "Transport ready (rx=%s tx=%s resp=%s)",
            s_rx_acc ? "PSRAM" : "ERR", s_tx_buf ? "PSRAM" : "ERR",
            s_resp_buf ? "PSRAM" : "ERR");
}

// Invoked by TinyUSB when data arrives on the vendor OUT endpoint.
// The vendor class first copies the received bytes into its RX FIFO
// (tu_edpt_stream_read_xfer_complete) and only then calls this callback, so
// the FIFO MUST be drained here. Using the raw endpoint buffer instead would
// leave the FIFO filling up until RX stalls (~RX_BUFSIZE bytes) and the host's
// bulk OUT transfer hangs.
void tud_vendor_rx_cb(uint8_t idx, const uint8_t *buffer, uint16_t bufsize)
{
    (void)idx;
    (void)buffer;
    (void)bufsize;

    uint8_t tmp[128];
    uint32_t n;
    while ((n = tud_vendor_read(tmp, sizeof(tmp))) > 0) {
        process_rx_bytes(tmp, n);
    }
}
