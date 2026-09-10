#include "uac_microphone.h"
#include "app_config.h"
#include "app_log.h"
#include "audio/audio_pipeline.h"

#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "tusb.h"
#include "device/usbd_pvt.h"

static uint8_t s_uac_ep_in = USB_EP_UAC_IN & 0x7F;
static uint8_t s_uac_itf_ac = USB_ITF_UAC_AC;
static uint8_t s_uac_itf_as = USB_ITF_UAC_AS;
static uint8_t s_uac_alt = 0;
static volatile bool s_uac_streaming = false;
static bool s_uac_initialized = false;

static uint8_t s_mic_mute = 0;
static int16_t s_mic_volume = 0x0000;

// 32 samples (64 bytes) per 2 ms isochronous transfer.
static DRAM_ATTR int16_t s_tx_buf[32];

// DWC2 register helpers used by the recovery watchdog.
#define DWC2_USB_BASE       0x60080000
#define DWC2_DIEPCTL(n)     (*(volatile uint32_t *)(DWC2_USB_BASE + 0x900 + (n) * 0x20))
#define DWC2_EPCTL_EPDIS    (1u << 30)
#define DWC2_EPCTL_SNAK     (1u << 27)

static volatile uint32_t s_xfer_cb_count = 0;

static void uac_watchdog_task(void *arg)
{
    (void)arg;
    uint32_t last_count = 0;
    uint32_t stuck_ticks = 0;

    while (1) {
        vTaskDelay(pdMS_TO_TICKS(10));

        if (tud_mounted() && !tud_suspended() && s_uac_streaming) {
            if (s_xfer_cb_count == last_count) {
                stuck_ticks += 10;
                if (stuck_ticks >= 50) {
                    app_log("UAC", "Isochronous IN stalled -> forcing endpoint recovery");
                    uint8_t epnum = s_uac_ep_in & 0x7F;
                    DWC2_DIEPCTL(epnum) |= (DWC2_EPCTL_EPDIS | DWC2_EPCTL_SNAK);
                    vTaskDelay(pdMS_TO_TICKS(2));
                    usbd_edpt_clear_stall(0, (uint8_t)(s_uac_ep_in | 0x80));
                    memset(s_tx_buf, 0, sizeof(s_tx_buf));
                    usbd_edpt_xfer(0, (uint8_t)(s_uac_ep_in | 0x80), (uint8_t *)s_tx_buf, sizeof(s_tx_buf));
                    stuck_ticks = 0;
                }
            } else {
                last_count = s_xfer_cb_count;
                stuck_ticks = 0;
            }
        } else {
            stuck_ticks = 0;
            last_count = s_xfer_cb_count;
        }
    }
}

// ---------------------------------------------------------------------------
// TinyUSB custom class driver
// ---------------------------------------------------------------------------
static void uac_driver_init(void) {}

static void uac_driver_reset(uint8_t rhport)
{
    (void)rhport;
    s_uac_streaming = false;
    s_uac_alt = 0;
    s_xfer_cb_count = 0;
    app_log("UAC", "USB bus reset -> UAC state cleared");
}

static uint16_t uac_driver_open(uint8_t rhport, tusb_desc_interface_t const *desc_intf, uint16_t max_len)
{
    if (desc_intf->bInterfaceClass != TUSB_CLASS_AUDIO) {
        return 0;
    }

    uint8_t const *p = (uint8_t const *)desc_intf;
    uint16_t len = 0;
    while (len < max_len) {
        if (p[1] == TUSB_DESC_INTERFACE) {
            if (((tusb_desc_interface_t const *)p)->bInterfaceClass != TUSB_CLASS_AUDIO) {
                break;
            }
        } else if (p[1] == TUSB_DESC_ENDPOINT) {
            usbd_edpt_open(rhport, (tusb_desc_endpoint_t const *)p);
        }
        len += p[0];
        p += p[0];
    }
    return len;
}

static bool uac_driver_control_xfer_cb(uint8_t rhport, uint8_t stage,
                                       tusb_control_request_t const *req)
{
    if (stage != CONTROL_STAGE_SETUP) {
        return true;
    }

    // Standard requests
    if (req->bmRequestType_bit.type == TUSB_REQ_TYPE_STANDARD) {
        if (req->bRequest == TUSB_REQ_SET_INTERFACE) {
            uint8_t itf = (uint8_t)req->wIndex;
            if (itf != s_uac_itf_as && itf != s_uac_itf_ac) {
                return false; // let other class drivers handle their interfaces
            }
            uint8_t alt = (uint8_t)req->wValue;
            s_uac_alt = alt;
            s_uac_streaming = (alt == 1);

            usbd_edpt_close(rhport, (uint8_t)(s_uac_ep_in | 0x80));

            if (alt == 1) {
                tusb_desc_endpoint_t ep;
                ep.bLength = sizeof(tusb_desc_endpoint_t);
                ep.bDescriptorType = TUSB_DESC_ENDPOINT;
                ep.bEndpointAddress = (uint8_t)(s_uac_ep_in | 0x80);
                ep.bmAttributes.xfer = TUSB_XFER_ISOCHRONOUS;
                ep.bmAttributes.sync = 1;
                ep.wMaxPacketSize = 64;
                ep.bInterval = 2;
                usbd_edpt_open(rhport, &ep);

                memset(s_tx_buf, 0, sizeof(s_tx_buf));
                usbd_edpt_xfer(rhport, ep.bEndpointAddress, (uint8_t *)s_tx_buf, sizeof(s_tx_buf));
            } else {
                usbd_edpt_close(rhport, (uint8_t)(s_uac_ep_in | 0x80));
            }
            return tud_control_status(rhport, req);
        } else if (req->bRequest == TUSB_REQ_GET_INTERFACE) {
            uint8_t itf = (uint8_t)req->wIndex;
            if (itf != s_uac_itf_as && itf != s_uac_itf_ac) {
                return false;
            }
            return tud_control_xfer(rhport, req, &s_uac_alt, 1);
        }
        return false;
    }

    // Class-specific requests (audio control)
    if (req->bmRequestType_bit.type == TUSB_REQ_TYPE_CLASS) {
        uint8_t target_itf = (uint8_t)req->wIndex;
        if (target_itf != s_uac_itf_ac && target_itf != s_uac_itf_as && target_itf != 0x02) {
            return false;
        }
        uint8_t r = req->bRequest;
        uint8_t cs = (uint8_t)(req->wValue >> 8);
        if (r == 0x81) { // GET_CUR
            if (cs == 0x01) return tud_control_xfer(rhport, req, &s_mic_mute, 1);
            return tud_control_xfer(rhport, req, &s_mic_volume, 2);
        }
        if (r == 0x01) { // SET_CUR
            if (cs == 0x01) return tud_control_xfer(rhport, req, &s_mic_mute, 1);
            return tud_control_xfer(rhport, req, &s_mic_volume, 2);
        }
        static int16_t vol_min = -32768, vol_max = 0, vol_res = 256;
        if (r == 0x82) return tud_control_xfer(rhport, req, &vol_min, 2);
        if (r == 0x83) return tud_control_xfer(rhport, req, &vol_max, 2);
        if (r == 0x84) return tud_control_xfer(rhport, req, &vol_res, 2);
        return false;
    }

    return false;
}

static bool uac_driver_xfer_cb(uint8_t rhport, uint8_t ep_addr,
                               xfer_result_t result, uint32_t xferred_bytes)
{
    (void)result;
    (void)xferred_bytes;

    if (ep_addr == (uint8_t)(s_uac_ep_in | 0x80)) {
        if (s_uac_streaming) {
            memset(s_tx_buf, 0, sizeof(s_tx_buf));
            if (!s_mic_mute) {
                audio_pipeline_read_for_usb(&g_audio_pipeline, s_tx_buf, 32);
            }
            usbd_edpt_xfer(rhport, ep_addr, (uint8_t *)s_tx_buf, sizeof(s_tx_buf));
            s_xfer_cb_count++;
        }
        return true;
    }
    return true;
}

static usbd_class_driver_t const s_uac_driver = {
#if CFG_TUSB_DEBUG >= CFG_TUD_LOG_LEVEL
    .name = "UAC_MIC",
#endif
    .init = uac_driver_init,
    .deinit = NULL,
    .reset = uac_driver_reset,
    .open = uac_driver_open,
    .control_xfer_cb = uac_driver_control_xfer_cb,
    .xfer_cb = uac_driver_xfer_cb,
    .xfer_isr = NULL,
    .sof = NULL,
};

usbd_class_driver_t const *usbd_app_driver_get_cb(uint8_t *driver_count)
{
    *driver_count = 1;
    return &s_uac_driver;
}

bool uac_microphone_init(void)
{
    if (s_uac_initialized) return true;

    xTaskCreatePinnedToCore(uac_watchdog_task, "uac_wdg", 3072, NULL, 5, NULL, TASK_CORE_USB);

    s_uac_initialized = true;
    app_log("UAC", "UAC 1.0 microphone class driver registered (EP %02X IN)", USB_EP_UAC_IN);
    return true;
}

void uac_microphone_task(void)
{
    // Audio is pushed from the TinyUSB transfer callback.
}

bool uac_microphone_is_streaming(void)
{
    return s_uac_streaming;
}
