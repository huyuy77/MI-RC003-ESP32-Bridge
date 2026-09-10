#include "usb_descriptors.h"
#include "app_config.h"
#include "version.h"

#include "tusb.h"
#include "class/hid/hid_device.h"
#include "class/vendor/vendor_device.h"

// ===========================================================================
// Device descriptor
// ===========================================================================
const tusb_desc_device_t usb_device_descriptor = {
    .bLength = sizeof(tusb_desc_device_t),
    .bDescriptorType = TUSB_DESC_DEVICE,
    .bcdUSB = 0x0210, // >= 2.1 is required for BOS / WebUSB
    .bDeviceClass = TUSB_CLASS_MISC,
    .bDeviceSubClass = MISC_SUBCLASS_COMMON,
    .bDeviceProtocol = MISC_PROTOCOL_IAD,
    .bMaxPacketSize0 = CFG_TUD_ENDPOINT0_SIZE,
    .idVendor = 0x303A,      // Espressif
    .idProduct = 0x8301,     // MIRC003 bridge
    .bcdDevice = 0x0100,
    .iManufacturer = 0x01,
    .iProduct = 0x02,
    .iSerialNumber = 0x03,
    .bNumConfigurations = 0x01,
};

// ===========================================================================
// String descriptors
// ===========================================================================
const char *usb_string_descriptors[] = {
    (char[]){0x09, 0x04},        // 0: language id (English US)
    "HD838A",                    // 1: manufacturer
    "MIRC003 Remote Bridge",     // 2: product
    "MIRC003-0001",              // 3: serial
    WEBUSB_LANDING_URL,          // 4: WebUSB landing page
    "MIRC003 HID",               // 5: HID interface
    "MIRC003 Microphone",        // 6: UAC microphone
    "MIRC003 WebUSB",            // 7: WebUSB vendor interface
};
const int usb_string_descriptor_count =
    (int)(sizeof(usb_string_descriptors) / sizeof(usb_string_descriptors[0]));

// ===========================================================================
// HID report descriptor: keyboard (report ID 1) + consumer (report ID 2)
// ===========================================================================
const uint8_t usb_hid_report_descriptor[] = {
    TUD_HID_REPORT_DESC_KEYBOARD(HID_REPORT_ID(1)),
    TUD_HID_REPORT_DESC_CONSUMER(HID_REPORT_ID(2)),
};
const uint16_t usb_hid_report_descriptor_len = sizeof(usb_hid_report_descriptor);

// ===========================================================================
// Configuration descriptor
//
//   ITF 0/1 : UAC 1.0 microphone (custom class driver, 108-byte descriptor set)
//   ITF 2   : HID keyboard + consumer control
//   ITF 3   : WebUSB vendor-specific bulk interface
// ===========================================================================
#define USB_CONFIG_TOTAL_LEN  (TUD_CONFIG_DESC_LEN + 108 + TUD_HID_DESC_LEN + TUD_VENDOR_DESC_LEN)

const uint8_t usb_config_descriptor[] = {
    // Configuration number, interface count, string index, total length, attributes, power (mA)
    TUD_CONFIG_DESCRIPTOR(1, 4, 0, USB_CONFIG_TOTAL_LEN,
                          TUSB_DESC_CONFIG_ATT_REMOTE_WAKEUP, 100),

    // -------------------- UAC 1.0 microphone (108 bytes) --------------------
    // 1. IAD (bFirstInterface=0, bInterfaceCount=2, audio, iFunction=6)
    0x08, 0x0B, USB_ITF_UAC_AC, 0x02, 0x01, 0x00, 0x00, 6,
    // 2. Standard AC interface
    0x09, 0x04, USB_ITF_UAC_AC, 0x00, 0x00, 0x01, 0x01, 0x00, 6,
    // 3. CS AC header
    0x09, 0x24, 0x01, 0x00, 0x01, 0x27, 0x00, 0x01, USB_ITF_UAC_AS,
    // 4. Input terminal (microphone)
    0x0C, 0x24, 0x02, 0x01, 0x01, 0x02, 0x00, 0x01, 0x01, 0x00, 0x00, 0x00,
    // 5. Feature unit (mute + volume)
    0x09, 0x24, 0x06, 0x02, 0x01, 0x01, 0x01, 0x02, 0x00,
    // 6. Output terminal (USB streaming)
    0x09, 0x24, 0x03, 0x03, 0x01, 0x01, 0x00, 0x02, 0x00,
    // 7. Standard AS interface, alt 0 (zero bandwidth)
    0x09, 0x04, USB_ITF_UAC_AS, 0x00, 0x00, 0x01, 0x02, 0x00, 0x00,
    // 8. Standard AS interface, alt 1 (active, 16 kHz)
    0x09, 0x04, USB_ITF_UAC_AS, 0x01, 0x01, 0x01, 0x02, 0x00, 0x00,
    // 9. CS AS general
    0x07, 0x24, 0x01, 0x03, 0x01, 0x01, 0x00,
    // 10. Format type I (16 kHz, 16-bit, mono)
    0x0B, 0x24, 0x02, 0x01, 0x01, 0x02, 0x10, 0x01, 0x80, 0x3E, 0x00,
    // 11. Isochronous IN endpoint (64 bytes, interval 2)
    0x09, 0x05, USB_EP_UAC_IN, 0x05, 0x40, 0x00, 0x02, 0x00, 0x00,
    // 12. CS endpoint general
    0x07, 0x25, 0x01, 0x00, 0x00, 0x00, 0x00,

    // -------------------- HID keyboard + consumer --------------------
    // Interface number, string index, boot protocol, report descriptor len,
    // EP IN address, EP size, polling interval (ms)
    TUD_HID_DESCRIPTOR(USB_ITF_HID, 5, false, sizeof(usb_hid_report_descriptor),
                       USB_EP_HID_IN, 16, 5),

    // -------------------- WebUSB vendor interface --------------------
    // Interface number, string index, EP OUT address, EP IN address, EP size
    TUD_VENDOR_DESCRIPTOR(USB_ITF_VENDOR, 7, USB_EP_VENDOR_OUT, USB_EP_VENDOR_IN, 64),
};

// ===========================================================================
// Binary Object Store (WebUSB)
// ===========================================================================
#define USB_BOS_TOTAL_LEN  (TUD_BOS_DESC_LEN + TUD_BOS_WEBUSB_DESC_LEN)

static const uint8_t usb_bos_descriptor[] = {
    TUD_BOS_DESCRIPTOR(USB_BOS_TOTAL_LEN, 1),
    TUD_BOS_WEBUSB_DESCRIPTOR(WEBUSB_VENDOR_CODE, 4),
};

uint8_t const *tud_descriptor_bos_cb(void)
{
    return usb_bos_descriptor;
}

// ===========================================================================
// WebUSB landing page URL descriptor
// ===========================================================================
static const tusb_desc_webusb_url_t usb_url_descriptor = {
    .bLength = (uint8_t)(3 + sizeof(WEBUSB_LANDING_URL) - 1),
    .bDescriptorType = 3, // WEBUSB URL descriptor type
    .bScheme = WEBUSB_LANDING_SCHEME,
    .url = WEBUSB_LANDING_URL,
};

// Invoked for every vendor-type control request. WebUSB uses this to fetch
// the landing page URL advertised in the BOS descriptor.
bool tud_vendor_control_xfer_cb(uint8_t rhport, uint8_t stage,
                                tusb_control_request_t const *request)
{
    if (stage != CONTROL_STAGE_SETUP) {
        return true;
    }
    if (request->bmRequestType_bit.type == TUSB_REQ_TYPE_VENDOR &&
        request->bRequest == WEBUSB_VENDOR_CODE) {
        return tud_control_xfer(rhport, request, (void *)(uintptr_t)&usb_url_descriptor,
                                usb_url_descriptor.bLength);
    }
    return false;
}

// ===========================================================================
// HID callbacks
// ===========================================================================
uint8_t const *tud_hid_descriptor_report_cb(uint8_t instance)
{
    (void)instance;
    return usb_hid_report_descriptor;
}

uint16_t tud_hid_get_report_cb(uint8_t instance, uint8_t report_id,
                               hid_report_type_t report_type, uint8_t *buffer, uint16_t reqlen)
{
    (void)instance; (void)report_id; (void)report_type; (void)buffer; (void)reqlen;
    return 0;
}

void tud_hid_set_report_cb(uint8_t instance, uint8_t report_id,
                           hid_report_type_t report_type,
                           uint8_t const *buffer, uint16_t bufsize)
{
    (void)instance; (void)report_id; (void)report_type; (void)buffer; (void)bufsize;
}
