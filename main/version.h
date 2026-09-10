#pragma once

// ============================================================
// Firmware identity
// ============================================================
#define FIRMWARE_NAME     "MIRC003 Bridge"
#define FIRMWARE_VERSION  "1.0.0"
#define FIRMWARE_BUILD    __DATE__ " " __TIME__
#define HARDWARE_TARGET   "ESP32-S3"

// ============================================================
// WebUSB configuration channel
// ============================================================
// The landing page advertised through the WebUSB BOS descriptor.
// Scheme is defined by WEBUSB_LANDING_SCHEME (0 = http, 1 = https).
// Keep this in sync with the static site in /webusb-config.
#define WEBUSB_LANDING_URL     "localhost:8000/"
#define WEBUSB_LANDING_SCHEME  0

// Vendor request code advertised in the BOS descriptor (GET_URL).
#define WEBUSB_VENDOR_CODE     0x01
// String descriptor index that holds the landing page URL.
#define WEBUSB_URL_STRING_INDEX 1
