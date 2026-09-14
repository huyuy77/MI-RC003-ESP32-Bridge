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
#define HID_REPORT_ID_MOUSE    3

static SemaphoreHandle_t s_hid_mutex = NULL;
static uint8_t s_mouse_buttons = 0;

// Real HID output state, used to drive the LED (yellow while the host is
// receiving a pressed key/button, cleared on release).
static bool s_keyboard_pressed = false;
static bool s_consumer_pressed = false;

static void update_hid_led(void)
{
    led_indicator_set_hid_active(s_keyboard_pressed || s_consumer_pressed || s_mouse_buttons != 0);
}

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
    s_keyboard_pressed = (modifier != 0 || keycode != 0);
    update_hid_led();

    hid_unlock();
    return true;
}

bool usb_hid_keyboard_release(void)
{
    hid_lock();

    // Always clear the tracked state, even when the bus is not ready, so the
    // LED cannot get stuck on after a disconnect.
    s_keyboard_pressed = false;
    update_hid_led();

    bool ok = false;
    if (tud_hid_ready()) {
        hid_keyboard_report_t report = {0};
        tud_hid_n_report(0, HID_REPORT_ID_KEYBOARD, &report, sizeof(report));
        ok = true;
    }

    hid_unlock();
    return ok;
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
    s_consumer_pressed = (usage_code != 0);
    update_hid_led();

    hid_unlock();
    return true;
}

bool usb_hid_consumer_release(void)
{
    hid_lock();

    s_consumer_pressed = false;
    update_hid_led();

    bool ok = false;
    if (tud_hid_ready()) {
        uint8_t report[2] = {0, 0};
        tud_hid_n_report(0, HID_REPORT_ID_CONSUMER, report, sizeof(report));
        ok = true;
    }

    hid_unlock();
    return ok;
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

// Caller must hold the HID mutex.
static bool mouse_report_locked(uint8_t buttons, int8_t dx, int8_t dy, int8_t wheel)
{
    if (!tud_hid_ready()) {
        return false;
    }
    if (tud_suspended()) {
        tud_remote_wakeup();
        vTaskDelay(pdMS_TO_TICKS(10));
    }

    hid_mouse_report_t report = {0};
    report.buttons = buttons;
    report.x = dx;
    report.y = dy;
    report.wheel = wheel;
    tud_hid_n_report(0, HID_REPORT_ID_MOUSE, &report, sizeof(report));
    return true;
}

bool usb_hid_mouse_button_press(uint8_t button_mask)
{
    hid_lock();
    s_mouse_buttons |= button_mask;
    bool ok = mouse_report_locked(s_mouse_buttons, 0, 0, 0);
    update_hid_led();
    hid_unlock();
    return ok;
}

bool usb_hid_mouse_button_release(uint8_t button_mask)
{
    hid_lock();
    s_mouse_buttons &= (uint8_t)~button_mask;
    bool ok = mouse_report_locked(s_mouse_buttons, 0, 0, 0);
    update_hid_led();
    hid_unlock();
    return ok;
}

bool usb_hid_mouse_buttons_release(void)
{
    hid_lock();
    s_mouse_buttons = 0;
    bool ok = mouse_report_locked(0, 0, 0, 0);
    update_hid_led();
    hid_unlock();
    return ok;
}

bool usb_hid_mouse_move(int8_t dx, int8_t dy)
{
    hid_lock();
    bool ok = mouse_report_locked(s_mouse_buttons, dx, dy, 0);
    hid_unlock();
    return ok;
}

bool usb_hid_mouse_wheel(int8_t wheel)
{
    hid_lock();
    bool ok = mouse_report_locked(s_mouse_buttons, 0, 0, wheel);
    hid_unlock();
    return ok;
}

void usb_hid_dispatch_action(const key_action_t *action)
{
    if (!action) return;

    app_log("USB_HID", "Emit action type=%d mod=0x%02X key=0x%02X cons=0x%04X dx=%d dy=%d wheel=%d",
            action->type, action->modifier, action->key_code, action->consumer_code,
            action->mouse_dx, action->mouse_dy, action->mouse_wheel);

    // The LED is driven by the real HID output state: usb_hid_*_press/release
    // turn it yellow while the host is receiving a held key/button. Voice
    // actions still take over with the blue streaming colour.
    if (action->type == ACTION_VOICE_HOLD) {
        led_indicator_set(LED_STATE_MIC_STREAMING);
    } else if (action->type == ACTION_VOICE_RELEASE) {
        led_indicator_set(LED_STATE_CONNECTED);
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
        case ACTION_MOUSE_BUTTON_TAP:
            usb_hid_mouse_button_press(action->key_code);
            vTaskDelay(pdMS_TO_TICKS(15));
            usb_hid_mouse_button_release(action->key_code);
            break;
        case ACTION_MOUSE_BUTTON_HOLD:
            usb_hid_mouse_button_press(action->key_code);
            break;
        case ACTION_MOUSE_BUTTON_RELEASE:
            // Internal action only: emitted when a mouse-button-hold key is
            // released. A configured "mouse button release" action no longer
            // exists, so the button mask is always present here.
            if (action->key_code) {
                usb_hid_mouse_button_release(action->key_code);
            }
            break;
        case ACTION_MOUSE_MOVE:
            usb_hid_mouse_move(action->mouse_dx, action->mouse_dy);
            break;
        case ACTION_MOUSE_WHEEL:
            usb_hid_mouse_wheel(action->mouse_wheel);
            break;
        default:
            break;
    }
}
