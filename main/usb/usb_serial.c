#include "usb_serial.h"

#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "tusb.h"
#include "class/cdc/cdc_device.h"

static SemaphoreHandle_t s_mutex = NULL;

void usb_serial_init(void)
{
    if (!s_mutex) {
        s_mutex = xSemaphoreCreateMutex();
    }
}

bool usb_serial_connected(void)
{
    return tud_mounted() && tud_cdc_connected();
}

void usb_serial_write(const char *s)
{
    if (!s || !tud_mounted() || !tud_cdc_connected()) {
        return;
    }
    if (s_mutex && xSemaphoreTake(s_mutex, 0) != pdTRUE) {
        return; // console busy, drop this line rather than block
    }

    size_t len = strlen(s);
    size_t off = 0;
    while (off < len) {
        uint32_t avail = tud_cdc_write_available();
        if (avail == 0) {
            tud_cdc_write_flush();
            break;
        }
        size_t chunk = len - off;
        if (chunk > avail) {
            chunk = avail;
        }
        uint32_t written = tud_cdc_write(s + off, chunk);
        if (written == 0) {
            break;
        }
        off += written;
    }
    tud_cdc_write_flush();

    if (s_mutex) {
        xSemaphoreGive(s_mutex);
    }
}
