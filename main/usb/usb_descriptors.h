#pragma once

#include <stdint.h>
#include "tusb.h"

#ifdef __cplusplus
extern "C" {
#endif

// Descriptor objects handed to tinyusb_driver_install().
extern const tusb_desc_device_t usb_device_descriptor;
extern const uint8_t            usb_config_descriptor[];
extern const char              *usb_string_descriptors[];
extern const int                usb_string_descriptor_count;

// HID report descriptor (keyboard report ID 1 + consumer report ID 2).
extern const uint8_t usb_hid_report_descriptor[];
extern const uint16_t usb_hid_report_descriptor_len;

#ifdef __cplusplus
}
#endif
