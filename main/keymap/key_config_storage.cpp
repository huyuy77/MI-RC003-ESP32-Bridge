#include "key_config_storage.h"
#include "app_log.h"
#include "storage/config_store.h"

#include <string.h>
#include <stdlib.h>
#include <stdio.h>
#include <string>
#include <ArduinoJson.h>

#define KEYMAP_NS   "keymap_conf"
#define KEYMAP_KEY  "cfg_json"
#define KEYMAP_JSON_MAX 8192

static uint32_t parse_u32_or_hex(JsonVariant v, uint32_t default_val = 0)
{
    if (v.isNull()) return default_val;
    if (v.is<int>() || v.is<unsigned int>() || v.is<long>() || v.is<unsigned long>()) {
        return v.as<uint32_t>();
    }
    if (v.is<const char *>() || v.is<std::string>()) {
        std::string s = v.as<std::string>();
        if (!s.empty() && (s[0] == '0') && (s.size() > 1) && (s[1] == 'x' || s[1] == 'X')) {
            return (uint32_t)strtoul(s.c_str(), NULL, 16);
        }
        return (uint32_t)strtoul(s.c_str(), NULL, 10);
    }
    return default_val;
}

static void parse_bindings_array(JsonArray arr, key_layer_t *layer)
{
    if (!layer || arr.isNull()) return;
    layer->binding_count = 0;
    for (JsonObject obj : arr) {
        if (layer->binding_count >= MAX_KEY_BINDINGS) break;

        key_binding_t b;
        memset(&b, 0, sizeof(b));

        b.source_vk = parse_u32_or_hex(obj["source_vk"], 0);

        b.has_click = obj["has_click"] | false;
        b.click_action.type = (key_action_type_t)parse_u32_or_hex(obj["click_type"], 0);
        b.click_action.modifier = (uint8_t)parse_u32_or_hex(obj["click_mod"], 0);
        b.click_action.key_code = (uint8_t)parse_u32_or_hex(obj["click_key"], 0);
        b.click_action.consumer_code = (uint16_t)parse_u32_or_hex(obj["click_cons"], 0);
        b.click_action.target_layer = (uint8_t)parse_u32_or_hex(obj["click_layer"], 0);

        // Normalize HID voice usage (0x3E) to the canonical voice code (0x04).
        if (b.source_vk == MI_KEY_VOICE_ALT) {
            b.source_vk = MI_KEY_VOICE;
        }

        // Force ACTION_VOICE_HOLD for the voice key unless it switches layers.
        if (b.source_vk == MI_KEY_VOICE && b.click_action.type != ACTION_SWITCH_LAYER &&
            b.click_action.type != ACTION_TRANSPARENT) {
            b.click_action.type = ACTION_VOICE_HOLD;
        }

        b.has_long = obj["has_long"] | false;
        b.long_ms = parse_u32_or_hex(obj["long_ms"], 600);
        b.long_action.type = (key_action_type_t)parse_u32_or_hex(obj["long_type"], 1);
        b.long_action.modifier = (uint8_t)parse_u32_or_hex(obj["long_mod"], 0);
        b.long_action.key_code = (uint8_t)parse_u32_or_hex(obj["long_key"], 0);
        b.long_action.consumer_code = (uint16_t)parse_u32_or_hex(obj["long_cons"], 0);
        b.long_action.target_layer = (uint8_t)parse_u32_or_hex(obj["long_layer"], 0);

        b.has_double = obj["has_double"] | false;
        b.double_ms = parse_u32_or_hex(obj["double_ms"], 250);
        b.double_action.type = (key_action_type_t)parse_u32_or_hex(obj["double_type"], 1);
        b.double_action.modifier = (uint8_t)parse_u32_or_hex(obj["double_mod"], 0);
        b.double_action.key_code = (uint8_t)parse_u32_or_hex(obj["double_key"], 0);
        b.double_action.consumer_code = (uint16_t)parse_u32_or_hex(obj["double_cons"], 0);
        b.double_action.target_layer = (uint8_t)parse_u32_or_hex(obj["double_layer"], 0);

        b.has_repeat = obj["has_repeat"] | false;
        b.repeat_action.type = (key_action_type_t)parse_u32_or_hex(obj["repeat_type"], 0);
        b.repeat_action.modifier = (uint8_t)parse_u32_or_hex(obj["repeat_mod"], 0);
        b.repeat_action.key_code = (uint8_t)parse_u32_or_hex(obj["repeat_key"], 0);
        b.repeat_action.consumer_code = (uint16_t)parse_u32_or_hex(obj["repeat_cons"], 0);
        b.repeat_delay_ms = (uint16_t)parse_u32_or_hex(obj["repeat_delay_ms"], 350);
        b.repeat_interval_ms = (uint16_t)parse_u32_or_hex(obj["repeat_interval_ms"], 70);

        layer->bindings[layer->binding_count++] = b;
    }
}

size_t key_config_to_json(const key_mapper_engine_t *engine, char *out, size_t out_len)
{
    if (!out || out_len == 0) return 0;
    out[0] = '\0';
    if (!engine) return 0;

    JsonDocument doc;
    doc["active_layer"] = engine->active_layer;
    JsonArray layer_arr = doc["layers"].to<JsonArray>();

    for (size_t l = 0; l < MAX_LAYERS; l++) {
        const key_layer_t *layer = &engine->layers[l];
        JsonObject layer_obj = layer_arr.add<JsonObject>();
        layer_obj["id"] = (int)l;
        layer_obj["name"] = layer->name;
        layer_obj["type"] = (int)layer->type;
        layer_obj["timeout"] = layer->timeout_sec;

        char color_buf[16];
        snprintf(color_buf, sizeof(color_buf), "0x%06X", (unsigned int)(layer->led_color & 0xFFFFFF));
        layer_obj["color"] = color_buf;

        JsonArray arr = layer_obj["bindings"].to<JsonArray>();
        for (size_t i = 0; i < layer->binding_count; i++) {
            const key_binding_t *b = &layer->bindings[i];
            JsonObject obj = arr.add<JsonObject>();
            obj["source_vk"] = b->source_vk;

            if (b->has_click) {
                obj["has_click"] = true;
                obj["click_type"] = (int)b->click_action.type;
                if (b->click_action.modifier != 0) obj["click_mod"] = b->click_action.modifier;
                if (b->click_action.key_code != 0) obj["click_key"] = b->click_action.key_code;
                if (b->click_action.consumer_code != 0) obj["click_cons"] = b->click_action.consumer_code;
                if (b->click_action.type == ACTION_SWITCH_LAYER) obj["click_layer"] = b->click_action.target_layer;
            }
            if (b->has_long) {
                obj["has_long"] = true;
                obj["long_ms"] = b->long_ms;
                obj["long_type"] = (int)b->long_action.type;
                if (b->long_action.modifier != 0) obj["long_mod"] = b->long_action.modifier;
                if (b->long_action.key_code != 0) obj["long_key"] = b->long_action.key_code;
                if (b->long_action.consumer_code != 0) obj["long_cons"] = b->long_action.consumer_code;
                if (b->long_action.type == ACTION_SWITCH_LAYER) obj["long_layer"] = b->long_action.target_layer;
            }
            if (b->has_double) {
                obj["has_double"] = true;
                obj["double_ms"] = b->double_ms;
                obj["double_type"] = (int)b->double_action.type;
                if (b->double_action.modifier != 0) obj["double_mod"] = b->double_action.modifier;
                if (b->double_action.key_code != 0) obj["double_key"] = b->double_action.key_code;
                if (b->double_action.consumer_code != 0) obj["double_cons"] = b->double_action.consumer_code;
                if (b->double_action.type == ACTION_SWITCH_LAYER) obj["double_layer"] = b->double_action.target_layer;
            }
            if (b->has_repeat) {
                obj["has_repeat"] = true;
                obj["repeat_type"] = (int)b->repeat_action.type;
                if (b->repeat_action.modifier != 0) obj["repeat_mod"] = b->repeat_action.modifier;
                if (b->repeat_action.key_code != 0) obj["repeat_key"] = b->repeat_action.key_code;
                if (b->repeat_action.consumer_code != 0) obj["repeat_cons"] = b->repeat_action.consumer_code;
                obj["repeat_delay_ms"] = b->repeat_delay_ms;
                obj["repeat_interval_ms"] = b->repeat_interval_ms;
            }
        }
    }

    return serializeJson(doc, out, out_len);
}

bool key_config_from_json(key_mapper_engine_t *engine, const char *json_str)
{
    if (!engine || !json_str || json_str[0] == '\0') return false;

    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, json_str);
    if (err) {
        app_log("KEYMAP", "JSON deserialize failed: %s", err.c_str());
        return false;
    }

    if (doc["layers"].is<JsonArray>()) {
        JsonArray layers_arr = doc["layers"].as<JsonArray>();
        for (JsonObject l_obj : layers_arr) {
            uint8_t id = (uint8_t)parse_u32_or_hex(l_obj["id"], 0);
            if (id >= MAX_LAYERS) continue;

            key_layer_t *layer = &engine->layers[id];
            if (!l_obj["name"].isNull()) {
                std::string nm = l_obj["name"].as<std::string>();
                strncpy(layer->name, nm.c_str(), sizeof(layer->name) - 1);
                layer->name[sizeof(layer->name) - 1] = '\0';
            }
            layer->type = (layer_type_t)parse_u32_or_hex(l_obj["type"], (uint32_t)layer->type);
            layer->timeout_sec = (uint16_t)parse_u32_or_hex(l_obj["timeout"], layer->timeout_sec);
            if (!l_obj["color"].isNull()) {
                layer->led_color = parse_u32_or_hex(l_obj["color"], layer->led_color);
            }
            JsonArray b_arr = l_obj["bindings"].as<JsonArray>();
            if (!b_arr.isNull()) {
                parse_bindings_array(b_arr, layer);
            }
        }
        app_log("KEYMAP", "Loaded multi-layer keymap from JSON");
        return true;
    }

    // Legacy single-layer schema: root "bindings" array.
    if (doc["bindings"].is<JsonArray>()) {
        parse_bindings_array(doc["bindings"].as<JsonArray>(), &engine->layers[0]);
        app_log("KEYMAP", "Migrated legacy single-layer keymap into Layer 0");
        return true;
    }

    return false;
}

bool key_config_storage_save(key_mapper_engine_t *engine)
{
    if (!engine) return false;

    char *json = (char *)malloc(KEYMAP_JSON_MAX);
    if (!json) return false;

    size_t len = key_config_to_json(engine, json, KEYMAP_JSON_MAX);
    if (len == 0) {
        free(json);
        app_log("KEYMAP", "Failed to serialize keymap for NVS");
        return false;
    }

    esp_err_t err = config_store_set_str(KEYMAP_NS, KEYMAP_KEY, json);
    free(json);

    if (err != ESP_OK) {
        app_log("KEYMAP", "NVS write failed: %d", err);
        return false;
    }
    app_log("KEYMAP", "Keymap saved to NVS (%u bytes)", (unsigned)len);
    return true;
}

bool key_config_storage_load(key_mapper_engine_t *engine)
{
    if (!engine) return false;

    char *json = (char *)malloc(KEYMAP_JSON_MAX);
    if (!json) return false;

    size_t len = config_store_get_str(KEYMAP_NS, KEYMAP_KEY, json, KEYMAP_JSON_MAX);
    if (len == 0) {
        free(json);
        key_engine_load_defaults(engine);
        return false;
    }

    bool ok = key_config_from_json(engine, json);
    free(json);

    if (!ok || engine->layers[0].binding_count == 0) {
        app_log("KEYMAP", "Stored keymap invalid -> falling back to defaults");
        key_engine_load_defaults(engine);
        return false;
    }
    return true;
}

void key_config_storage_init(key_mapper_engine_t *engine)
{
    if (key_config_storage_load(engine)) {
        app_log("KEYMAP", "Loaded custom keymap from NVS (active layer %u)",
                (unsigned)engine->active_layer);
    } else {
        app_log("KEYMAP", "Loaded factory default keymap");
    }
}

void key_config_storage_reset_defaults(key_mapper_engine_t *engine)
{
    if (!engine) return;
    config_store_erase_key(KEYMAP_NS, KEYMAP_KEY);
    key_engine_load_defaults(engine);
    app_log("KEYMAP", "Keymap reset to factory defaults");
}

size_t key_telemetry_to_json(const key_mapper_engine_t *engine, char *out, size_t out_len)
{
    if (!out || out_len == 0) return 0;
    out[0] = '\0';
    if (!engine) return 0;

    JsonDocument doc;
    doc["source_vk"] = engine->last_telemetry.source_vk;
    doc["is_pressed"] = engine->last_telemetry.is_pressed;
    doc["duration_ms"] = engine->last_telemetry.duration_ms;
    doc["action_type"] = engine->last_telemetry.action_type;
    doc["modifier"] = engine->last_telemetry.modifier;
    doc["key_code"] = engine->last_telemetry.key_code;
    doc["consumer_code"] = engine->last_telemetry.consumer_code;
    doc["active_layer"] = engine->active_layer;

    return serializeJson(doc, out, out_len);
}
