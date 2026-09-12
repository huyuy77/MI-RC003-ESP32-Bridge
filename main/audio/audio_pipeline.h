#pragma once

#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
#include "app_config.h"
#include "adpcm_decoder.h"
#include "audio_filter.h"
#include "audio_agc.h"
#include "audio_ring_buffer.h"

#ifdef __cplusplus
extern "C" {
#endif

#define AUDIO_JITTER_PREFILL_SAMPLES  1600  // 100 ms prefill cushion to absorb BLE jitter

typedef struct {
    adpcm_state_t        adpcm;
    audio_filter_state_t filter;
    audio_agc_t          agc;
    audio_ring_buffer_t  ring_buf;
    int16_t              ring_storage[AUDIO_RING_BUFFER_SIZE];
    int16_t              temp_pcm[AUDIO_DEFAULT_FRAME_SAMPS * 2];
    uint8_t              session_id;
    bool                 active;
    bool                 buffering;
    uint32_t             total_frames_decoded;
    uint32_t             total_samples_pushed;
    uint32_t             underrun_count;
    uint32_t             lead_mute_remaining;
    uint32_t             fade_in_remaining;
    uint16_t             session_peak_in;
    uint16_t             session_peak_out;
    uint32_t             usb_reads;
    uint32_t             usb_padded;
    uint64_t             session_start_us;
} audio_pipeline_t;

extern audio_pipeline_t g_audio_pipeline;

void audio_pipeline_init(audio_pipeline_t *pipeline);
void audio_pipeline_start_session(audio_pipeline_t *pipeline, uint8_t session_id);
void audio_pipeline_set_nibble_order(audio_pipeline_t *pipeline, bool low_nibble_first);
void audio_pipeline_sync(audio_pipeline_t *pipeline, int16_t predictor, int8_t step_index);
size_t audio_pipeline_feed_adpcm(audio_pipeline_t *pipeline, const uint8_t *adpcm_bytes, size_t len);
size_t audio_pipeline_read_for_usb(audio_pipeline_t *pipeline, int16_t *out_pcm, size_t sample_count);
void audio_pipeline_stop_session(audio_pipeline_t *pipeline);

#ifdef __cplusplus
}
#endif
