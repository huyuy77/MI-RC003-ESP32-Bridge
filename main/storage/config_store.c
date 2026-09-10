#include "config_store.h"

#include <string.h>
#include "nvs_flash.h"
#include "nvs.h"
#include "esp_log.h"

static const char *TAG = "NVS";

// Bump this whenever the on-flash layout changes in a way that is not
// backward compatible (e.g. migrating from the Arduino RemoteMapper firmware,
// whose NimBLE bond structs have a different size).
#define NVS_SCHEMA "3"

esp_err_t config_store_init(void)
{
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_LOGW(TAG, "NVS partition needs recovery, erasing...");
        ESP_ERROR_CHECK(nvs_flash_erase());
        err = nvs_flash_init();
    }
    if (err != ESP_OK) {
        return err;
    }

    // One-time migration: wipe NVS if it was written by an incompatible layout.
    char schema[8] = {0};
    config_store_get_str("sys_conf", "schema", schema, sizeof(schema));
    if (strcmp(schema, NVS_SCHEMA) != 0) {
        ESP_LOGW(TAG, "NVS schema mismatch ('%s' != '%s'), erasing NVS", schema, NVS_SCHEMA);
        ESP_ERROR_CHECK(nvs_flash_erase());
        ESP_ERROR_CHECK(nvs_flash_init());
        config_store_set_str("sys_conf", "schema", NVS_SCHEMA);
    }
    return ESP_OK;
}

esp_err_t config_store_set_str(const char *ns, const char *key, const char *value)
{
    nvs_handle_t h;
    esp_err_t err = nvs_open(ns, NVS_READWRITE, &h);
    if (err != ESP_OK) return err;
    err = nvs_set_str(h, key, value ? value : "");
    if (err == ESP_OK) {
        err = nvs_commit(h);
    }
    nvs_close(h);
    return err;
}

size_t config_store_get_str(const char *ns, const char *key, char *out, size_t out_len)
{
    if (!out || out_len == 0) return 0;
    out[0] = '\0';

    nvs_handle_t h;
    if (nvs_open(ns, NVS_READONLY, &h) != ESP_OK) {
        return 0;
    }
    size_t len = out_len;
    esp_err_t err = nvs_get_str(h, key, out, &len);
    nvs_close(h);

    if (err != ESP_OK) {
        out[0] = '\0';
        return 0;
    }
    // nvs_get_str writes a NUL terminator; len includes it.
    return (len > 0) ? (len - 1) : 0;
}

esp_err_t config_store_set_blob(const char *ns, const char *key, const void *data, size_t len)
{
    nvs_handle_t h;
    esp_err_t err = nvs_open(ns, NVS_READWRITE, &h);
    if (err != ESP_OK) return err;
    err = nvs_set_blob(h, key, data, len);
    if (err == ESP_OK) {
        err = nvs_commit(h);
    }
    nvs_close(h);
    return err;
}

size_t config_store_get_blob(const char *ns, const char *key, void *out, size_t out_len)
{
    if (!out || out_len == 0) return 0;
    nvs_handle_t h;
    if (nvs_open(ns, NVS_READONLY, &h) != ESP_OK) return 0;
    size_t len = out_len;
    esp_err_t err = nvs_get_blob(h, key, out, &len);
    nvs_close(h);
    return (err == ESP_OK) ? len : 0;
}

esp_err_t config_store_erase_key(const char *ns, const char *key)
{
    nvs_handle_t h;
    esp_err_t err = nvs_open(ns, NVS_READWRITE, &h);
    if (err != ESP_OK) return err;
    err = nvs_erase_key(h, key);
    if (err == ESP_OK || err == ESP_ERR_NVS_NOT_FOUND) {
        nvs_commit(h);
        err = ESP_OK;
    }
    nvs_close(h);
    return err;
}

esp_err_t config_store_erase_ns(const char *ns)
{
    nvs_handle_t h;
    esp_err_t err = nvs_open(ns, NVS_READWRITE, &h);
    if (err != ESP_OK) return err;
    err = nvs_erase_all(h);
    if (err == ESP_OK) {
        nvs_commit(h);
    }
    nvs_close(h);
    return err;
}

esp_err_t config_store_erase_all(void)
{
    return nvs_flash_erase();
}
