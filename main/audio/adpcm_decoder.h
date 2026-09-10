#pragma once

#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    int32_t predictor;      // Current PCM prediction value [-32768, 32767]
    int8_t  step_index;     // Current step table index [0, 88]
} adpcm_state_t;

void adpcm_init_state(adpcm_state_t *state);
void adpcm_sync_state(adpcm_state_t *state, int16_t predictor, int8_t step_index);
int16_t adpcm_decode_nibble(adpcm_state_t *state, uint8_t nibble);

/**
 * @brief Decode a complete ADPCM frame (high nibble first) into 16-bit PCM.
 * @return Number of PCM samples decoded (in_bytes * 2)
 */
size_t adpcm_decode_frame(adpcm_state_t *state, const uint8_t *in_data, size_t in_bytes, int16_t *out_pcm);

#ifdef __cplusplus
}
#endif
