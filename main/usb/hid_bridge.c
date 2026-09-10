#include "hid_bridge.h"
#include "app_config.h"
#include "app_log.h"
#include "audio/audio_pipeline.h"
#include "led/led_indicator.h"

#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "tusb.h"
#include "class/hid/hid_device.h"

#define HID_REPORT_ID_KEYBOARD 1
#define HID_REPORT_ID_CONSUMER 2

static SemaphoreHandle_t s_hid_mutex = NULL;

static void hid_lock(void)
{
    if (!s_hid_mutex) {
        s_hid_mutex = xSemaphoreCreateMutex();
    }
    if (s_hid_mutex) {
        xSemaphoreTake(s_hid_mutex, portMAX_DELAY);
    }
}

static void hid_unlock(void)
{
    if (s_hid_mutex) {
        xSemaphoreGive(s_hid_mutex);
    }
}

void hid_bridge_init(void)
{
    if (!s_hid_mutex) {
        s_hid_mutex = xSemaphoreCreateMutex();
    }
}

bool usb_hid_keyboard_press(uint8_t modifier, uint8_t keycode)
{
    if (!tud_hid_ready()) {
        return false;
    }
    hid_lock();

    if (tud_suspended()) {
        tud_remote_wakeup();
        vTaskDelay(pdMS_TO_TICKS(15));
    }

    hid_keyboard_report_t report = {0};
    report.modifier = modifier;
    report.keycode[0] = keycode;
    tud_hid_n_report(0, HID_REPORT_ID_KEYBOARD, &report, sizeof(report));

    hid_unlock();
    return true;
}

bool usb_hid_keyboard_release(void)
{
    if (!tud_hid_ready()) {
        return false;
    }
    hid_lock();

    hid_keyboard_report_t report = {0};
    tud_hid_n_report(0, HID_REPORT_ID_KEYBOARD, &report, sizeof(report));

    hid_unlock();
    return true;
}

bool usb_hid_keyboard_tap(uint8_t modifier, uint8_t keycode)
{
    if (!usb_hid_keyboard_press(modifier, keycode)) {
        return false;
    }
    vTaskDelay(pdMS_TO_TICKS(15));
    usb_hid_keyboard_release();
    return true;
}

bool usb_hid_consumer_press(uint16_t usage_code)
{
    if (!tud_hid_ready()) {
        return false;
    }
    hid_lock();

    if (tud_suspended()) {
        tud_remote_wakeup();
        vTaskDelay(pdMS_TO_TICKS(10));
    }

    uint8_t report[2] = { (uint8_t)(usage_code & 0xFF), (uint8_t)(usage_code >> 8) };
    tud_hid_n_report(0, HID_REPORT_ID_CONSUMER, report, sizeof(report));

    hid_unlock();
    return true;
}

bool usb_hid_consumer_release(void)
{
    if (!tud_hid_ready()) {
        return false;
    }
    hid_lock();

    uint8_t report[2] = {0, 0};
    tud_hid_n_report(0, HID_REPORT_ID_CONSUMER, report, sizeof(report));

    hid_unlock();
    return true;
}

bool usb_hid_consumer_tap(uint16_t usage_code)
{
    if (!usb_hid_consumer_press(usage_code)) {
        return false;
    }
    vTaskDelay(pdMS_TO_TICKS(15));
    usb_hid_consumer_release();
    return true;
}

void usb_hid_dispatch_action(const key_action_t *action)
{
    if (!action) return;

    app_log("USB_HID", "Emit action type=%d mod=0x%02X key=0x%02X cons=0x%04X",
            action->type, action->modifier, action->key_code, action->consumer_code);

    if (action->type == ACTION_VOICE_HOLD) {
        led_indicator_set(LED_STATE_MIC_STREAMING);
    } else if (action->type == ACTION_VOICE_RELEASE) {
        led_indicator_set(LED_STATE_CONNECTED);
    } else {
        led_indicator_trigger_key(false);
    }

    switch (action->type) {
        case ACTION_KEYBOARD_TAP:
            usb_hid_keyboard_tap(action->modifier, action->key_code);
            break;
        case ACTION_KEYBOARD_HOLD:
            usb_hid_keyboard_press(action->modifier, action->key_code);
            break;
        case ACTION_KEYBOARD_RELEASE:
            usb_hid_keyboard_release();
            break;
        case ACTION_CONSUMER_TAP:
            usb_hid_consumer_tap(action->consumer_code);
            break;
        case ACTION_CONSUMER_HOLD:
            usb_hid_consumer_press(action->consumer_code);
            break;
        case ACTION_CONSUMER_RELEASE:
            usb_hid_consumer_release();
            break;
        case ACTION_VOICE_HOLD:
            audio_pipeline_start_session(&g_audio_pipeline, 0);
            if (action->modifier != 0 || action->key_code != 0) {
                usb_hid_keyboard_press(action->modifier, action->key_code);
            }
            break;
        case ACTION_VOICE_RELEASE:
            usb_hid_keyboard_release();
            audio_pipeline_stop_session(&g_audio_pipeline);
            break;
        default:
            break;
    }
}
