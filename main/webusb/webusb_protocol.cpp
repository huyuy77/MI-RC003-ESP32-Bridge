#include "webusb_protocol.h"
#include "app_config.h"
#include "version.h"
#include "app_log.h"
#include "ble/ble_remote_client.h"
#include "keymap/key_state_machine.h"
#include "keymap/key_config_storage.h"
#include "audio/audio_pipeline.h"
#include "storage/config_store.h"
#include "usb/usb_composite.h"

#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include <ArduinoJson.h>

#include "esp_system.h"
#include "esp_heap_caps.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

extern key_mapper_engine_t g_key_engine;

static size_t copy_str(uint8_t *resp, size_t resp_cap, const char *src)
{
    if (!src) {
        src = "";
    }
    size_t len = strlen(src);
    if (len > resp_cap) {
        len = resp_cap;
    }
    memcpy(resp, src, len);
    return len;
}

static size_t ok(uint8_t *resp, size_t resp_cap, const char *json)
{
    return copy_str(resp, resp_cap, json);
}

static void schedule_restart(void)
{
    xTaskCreate([](void *) {
        vTaskDelay(pdMS_TO_TICKS(600));
        esp_restart();
    }, "reboot", 2048, NULL, 3, NULL);
}

size_t webusb_protocol_handle(uint8_t cmd, const uint8_t *payload, size_t payload_len,
                              uint8_t *resp, size_t resp_cap, uint8_t *status)
{
    if (!resp || resp_cap == 0) {
        if (status) *status = WEBUSB_ERR_INTERNAL;
        return 0;
    }
    *status = WEBUSB_OK;

    switch (cmd) {
        case CMD_DEVICE_INFO: {
            size_t w = (size_t)snprintf((char *)resp, resp_cap,
                "{\"name\":\"%s\",\"version\":\"%s\",\"hardware\":\"%s\",\"protocol\":1,"
                "\"capabilities\":[\"keymap\",\"layers\",\"ble\",\"webusb\",\"uac\",\"hid\"]}",
                FIRMWARE_NAME, FIRMWARE_VERSION, HARDWARE_TARGET);
            return w;
        }

        case CMD_STATUS: {
            size_t w = (size_t)snprintf((char *)resp, resp_cap,
                "{\"firmware\":\"%s\",\"version\":\"%s\",\"uptime_sec\":%llu,"
                "\"ble_state\":%d,\"active_layer\":%u,\"frames_decoded\":%u,"
                "\"samples_pushed\":%u,\"free_heap\":%u,\"free_psram\":%u,"
                "\"usb_mounted\":%s}",
                FIRMWARE_NAME, FIRMWARE_VERSION,
                (unsigned long long)(esp_timer_get_time() / 1000000),
                (int)ble_remote_get_state(),
                (unsigned)key_engine_get_active_layer(&g_key_engine),
                (unsigned)g_audio_pipeline.total_frames_decoded,
                (unsigned)g_audio_pipeline.total_samples_pushed,
                (unsigned)esp_get_free_heap_size(),
                (unsigned)heap_caps_get_free_size(MALLOC_CAP_SPIRAM),
                usb_composite_is_mounted() ? "true" : "false");
            return w;
        }

        case CMD_LOGS_GET:
            return app_log_get_json((char *)resp, resp_cap);

        case CMD_LOGS_CLEAR:
            app_log_clear();
            return ok(resp, resp_cap, "{\"status\":\"cleared\"}");

        case CMD_KEYMAP_GET:
            return key_config_to_json(&g_key_engine, (char *)resp, resp_cap);

        case CMD_KEYMAP_SAVE: {
            if (!payload || payload_len == 0) {
                *status = WEBUSB_ERR_ARG;
                return ok(resp, resp_cap, "{\"error\":\"missing_body\"}");
            }
            char *json = (char *)heap_caps_malloc(payload_len + 1, MALLOC_CAP_SPIRAM);
            if (!json) {
                *status = WEBUSB_ERR_INTERNAL;
                return ok(resp, resp_cap, "{\"error\":\"no_mem\"}");
            }
            memcpy(json, payload, payload_len);
            json[payload_len] = '\0';

            app_log("KEYMAP", "Saving keymap (%u bytes)", (unsigned)payload_len);
            bool parsed = key_config_from_json(&g_key_engine, json);
            heap_caps_free(json);
            if (!parsed) {
                *status = WEBUSB_ERR_ARG;
                return ok(resp, resp_cap, "{\"error\":\"invalid_keymap_format\"}");
            }
            bool saved = key_config_storage_save(&g_key_engine);
            return ok(resp, resp_cap, saved ? "{\"status\":\"saved\"}" : "{\"error\":\"save_failed\"}");
        }

        case CMD_KEYMAP_RESET:
            key_config_storage_reset_defaults(&g_key_engine);
            return ok(resp, resp_cap, "{\"status\":\"reset_ok\"}");

        case CMD_KEYMAP_TELEMETRY:
            return key_telemetry_to_json(&g_key_engine, (char *)resp, resp_cap);

        case CMD_BLE_SCAN:
            return ble_remote_scan_devices_json((char *)resp, resp_cap);

        case CMD_BLE_CONNECT: {
            if (!payload || payload_len == 0) {
                *status = WEBUSB_ERR_ARG;
                return ok(resp, resp_cap, "{\"error\":\"missing_body\"}");
            }
            char *json = (char *)heap_caps_malloc(payload_len + 1, MALLOC_CAP_SPIRAM);
            if (!json) {
                *status = WEBUSB_ERR_INTERNAL;
                return ok(resp, resp_cap, "{\"error\":\"no_mem\"}");
            }
            memcpy(json, payload, payload_len);
            json[payload_len] = '\0';

            JsonDocument doc;
            DeserializationError err = deserializeJson(doc, json);
            heap_caps_free(json);
            if (err) {
                *status = WEBUSB_ERR_ARG;
                return ok(resp, resp_cap, "{\"error\":\"invalid_json\"}");
            }
            const char *mac = doc["mac"] | "";
            const char *name = doc["name"] | "Xiaomi Voice Remote";
            uint8_t type = doc["type"] | 1;
            if (!mac[0]) {
                *status = WEBUSB_ERR_ARG;
                return ok(resp, resp_cap, "{\"error\":\"empty_mac\"}");
            }
            bool ok_connect = ble_remote_connect_target(mac, type, name);
            return ok(resp, resp_cap, ok_connect ? "{\"status\":\"ok\"}" : "{\"status\":\"failed\"}");
        }

        case CMD_BLE_UNPAIR:
            ble_remote_unpair();
            return ok(resp, resp_cap, "{\"status\":\"ok\"}");

        case CMD_BLE_INFO:
            return ble_remote_get_connected_info((char *)resp, resp_cap);

        case CMD_BLE_RECONNECT:
            ble_remote_trigger_reconnect();
            return ok(resp, resp_cap, "{\"status\":\"reconnecting\"}");

        case CMD_NVS_RESET:
            app_log("SYSTEM", "Factory reset requested, erasing NVS...");
            config_store_erase_all();
            schedule_restart();
            return ok(resp, resp_cap, "{\"status\":\"erased\",\"message\":\"NVS erased, rebooting\"}");

        case CMD_SYSTEM_RESTART:
            app_log("SYSTEM", "Reboot requested via WebUSB");
            schedule_restart();
            return ok(resp, resp_cap, "{\"status\":\"rebooting\"}");

        default:
            *status = WEBUSB_ERR_CMD;
            return ok(resp, resp_cap, "{\"error\":\"unknown_command\"}");
    }
}
