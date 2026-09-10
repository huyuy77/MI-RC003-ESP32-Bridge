#pragma once

#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    float peak;             // Current peak envelope value
    float target_level;     // Target level (default 28000.0)
    float decay_rate;       // Envelope decay multiplier (default 0.9997)
    float max_gain;         // Maximum allowed gain boost (default 30.0)
    float noise_floor;      // Minimum floor to avoid amplifying silence (default 200.0)
} audio_agc_t;

void audio_agc_init(audio_agc_t *agc);
void audio_agc_reset(audio_agc_t *agc);
void audio_agc_process(audio_agc_t *agc, int16_t *samples, size_t count);

#ifdef __cplusplus
}
#endif
