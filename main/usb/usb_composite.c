#include "usb_composite.h"
#include "usb_descriptors.h"
#include "uac_microphone.h"
#include "hid_bridge.h"
#include "webusb_transport.h"
#include "app_config.h"
#include "app_log.h"

#include "tinyusb.h"
#include "tinyusb_default_config.h"
#include "tusb.h"
#include "esp_err.h"

static bool s_usb_mounted = false;

static void usb_event_cb(tinyusb_event_t *event, void *arg)
{
    (void)arg;
    switch (event->id) {
        case TINYUSB_EVENT_ATTACHED:
            s_usb_mounted = true;
            app_log("USB", "Device mounted (enumerated by host)");
            break;
        case TINYUSB_EVENT_DETACHED:
            s_usb_mounted = false;
            app_log("USB", "Device unmounted");
            break;
#ifdef CONFIG_TINYUSB_SUSPEND_CALLBACK
        case TINYUSB_EVENT_SUSPENDED:
            app_log("USB", "Host suspended the bus (PC sleep)");
            usb_hid_keyboard_release();
            usb_hid_consumer_release();
            break;
#endif
#ifdef CONFIG_TINYUSB_RESUME_CALLBACK
        case TINYUSB_EVENT_RESUMED:
            app_log("USB", "Host resumed the bus (PC wake)");
            break;
#endif
        default:
            break;
    }
}

bool usb_composite_init(void)
{
    hid_bridge_init();
    webusb_transport_init();
    uac_microphone_init();

    tinyusb_config_t cfg = TINYUSB_DEFAULT_CONFIG(usb_event_cb, NULL);
    cfg.descriptor.device = &usb_device_descriptor;
    cfg.descriptor.string = usb_string_descriptors;
    cfg.descriptor.string_count = usb_string_descriptor_count;
    cfg.descriptor.full_speed_config = usb_config_descriptor;

    esp_err_t err = tinyusb_driver_install(&cfg);
    if (err != ESP_OK) {
        app_log("USB", "tinyusb_driver_install failed: %s", esp_err_to_name(err));
        return false;
    }

    app_log("USB", "Composite device ready: UAC mic + HID + WebUSB");
    return true;
}

void usb_composite_task(void)
{
    uac_microphone_task();
}

bool usb_composite_is_mounted(void)
{
    return s_usb_mounted;
}
