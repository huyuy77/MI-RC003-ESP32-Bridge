#pragma once

#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    int32_t predictor;          // Current PCM prediction value [-32768, 32767]
    int8_t  step_index;         // Current step table index [0, 88]
    bool    low_nibble_first;   // ARN9 firmware packs the low nibble first
} adpcm_state_t;

void adpcm_init_state(adpcm_state_t *state);
void adpcm_set_nibble_order(adpcm_state_t *state, bool low_nibble_first);
void adpcm_sync_state(adpcm_state_t *state, int16_t predictor, int8_t step_index);
int16_t adpcm_decode_nibble(adpcm_state_t *state, uint8_t nibble);

/**
 * @brief Decode a complete ADPCM frame into 16-bit PCM.
 *
 * The nibble order is controlled by adpcm_set_nibble_order(); the default is
 * high nibble first (RC001/RC003 firmware 2671), while ARN9 firmware (Bluetooth
 * Remote 2 / 2 Pro) packs the low nibble first.
 *
 * @return Number of PCM samples decoded (in_bytes * 2)
 */
size_t adpcm_decode_frame(adpcm_state_t *state, const uint8_t *in_data, size_t in_bytes, int16_t *out_pcm);

#ifdef __cplusplus
}
#endif
