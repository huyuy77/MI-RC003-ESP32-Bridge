#include "audio_pipeline.h"
#include <string.h>
#include "app_log.h"

audio_pipeline_t g_audio_pipeline;

void audio_pipeline_init(audio_pipeline_t *pipeline)
{
    if (!pipeline) return;
    memset(pipeline, 0, sizeof(audio_pipeline_t));
    adpcm_init_state(&pipeline->adpcm);
    audio_filter_init(&pipeline->filter);
    audio_agc_init(&pipeline->agc);
    audio_ring_buffer_init(&pipeline->ring_buf, pipeline->ring_storage, AUDIO_RING_BUFFER_SIZE);
    pipeline->active = false;
    pipeline->buffering = false;
    pipeline->session_id = 0;
    pipeline->total_frames_decoded = 0;
    pipeline->total_samples_pushed = 0;
}

void audio_pipeline_start_session(audio_pipeline_t *pipeline, uint8_t session_id)
{
    if (!pipeline) return;
    adpcm_init_state(&pipeline->adpcm);
    audio_filter_init(&pipeline->filter);
    audio_agc_reset(&pipeline->agc);
    audio_ring_buffer_clear(&pipeline->ring_buf);
    pipeline->session_id = session_id;
    pipeline->active = true;
    pipeline->buffering = true; // Wait for the prefill cushion to prevent jitter underruns
    pipeline->lead_mute_remaining = AUDIO_LEAD_MUTE_SAMPLES;
    pipeline->fade_in_remaining = AUDIO_FADE_IN_SAMPLES;
    pipeline->total_frames_decoded = 0;
    pipeline->total_samples_pushed = 0;
    pipeline->underrun_count = 0;
}

void audio_pipeline_sync(audio_pipeline_t *pipeline, int16_t predictor, int8_t step_index)
{
    if (!pipeline) return;
    adpcm_sync_state(&pipeline->adpcm, predictor, step_index);
}

size_t audio_pipeline_feed_adpcm(audio_pipeline_t *pipeline, const uint8_t *adpcm_bytes, size_t len)
{
    if (!pipeline || !adpcm_bytes || len == 0 || !pipeline->active) return 0;

    size_t samples_decoded = adpcm_decode_frame(&pipeline->adpcm, adpcm_bytes, len, pipeline->temp_pcm);
    if (samples_decoded == 0) return 0;

    // 1. Declip (single-sample spike eliminator)
    audio_filter_declip(&pipeline->filter, pipeline->temp_pcm, samples_decoded, DECLIP_THRESHOLD);

    // 2. 3-tap triangle FIR low-pass [0.25, 0.5, 0.25]
    audio_filter_lowpass(&pipeline->filter, pipeline->temp_pcm, samples_decoded);

    // 3. DC blocker (~80 Hz high-pass)
    audio_filter_dc_block(&pipeline->filter, pipeline->temp_pcm, samples_decoded);

    // 4. Dynamic AGC + soft clip. During the lead-mute window feed zeros so the
    //    peak envelope does not decay and the gain stays locked at 1.0x.
    for (size_t i = 0; i < samples_decoded; i++) {
        if (pipeline->lead_mute_remaining > 0) {
            pipeline->temp_pcm[i] = 0;
            pipeline->lead_mute_remaining--;
        }
    }
    audio_agc_process(&pipeline->agc, pipeline->temp_pcm, samples_decoded);

    // 5. Micro fade-in applied after the AGC to smooth the mute boundary.
    for (size_t i = 0; i < samples_decoded; i++) {
        if (pipeline->fade_in_remaining > 0) {
            uint32_t step = AUDIO_FADE_IN_SAMPLES - pipeline->fade_in_remaining;
            pipeline->temp_pcm[i] = (int16_t)(((int32_t)pipeline->temp_pcm[i] * (int32_t)step) / AUDIO_FADE_IN_SAMPLES);
            pipeline->fade_in_remaining--;
        }
    }

    // 6. Enqueue into the ring buffer
    size_t written = audio_ring_buffer_write(&pipeline->ring_buf, pipeline->temp_pcm, samples_decoded);

    pipeline->total_frames_decoded++;
    pipeline->total_samples_pushed += written;

    if (pipeline->buffering) {
        if (audio_ring_buffer_available_read(&pipeline->ring_buf) >= AUDIO_JITTER_PREFILL_SAMPLES) {
            pipeline->buffering = false;
        }
    }

    return written;
}

size_t audio_pipeline_read_for_usb(audio_pipeline_t *pipeline, int16_t *out_pcm, size_t sample_count)
{
    if (!pipeline || !out_pcm || sample_count == 0) return 0;

    if (!pipeline->active || pipeline->buffering) {
        memset(out_pcm, 0, sample_count * sizeof(int16_t));
        return sample_count;
    }

    size_t avail = audio_ring_buffer_available_read(&pipeline->ring_buf);

    if (avail < sample_count) {
        pipeline->underrun_count++;
        size_t n = audio_ring_buffer_read(&pipeline->ring_buf, out_pcm, avail);
        int16_t last_val = (n > 0) ? out_pcm[n - 1] : 0;
        for (size_t i = n; i < sample_count; i++) {
            last_val = (int16_t)((last_val * 7) / 8);
            out_pcm[i] = last_val;
        }
        return sample_count;
    }

    audio_ring_buffer_read(&pipeline->ring_buf, out_pcm, sample_count);
    return sample_count;
}

void audio_pipeline_stop_session(audio_pipeline_t *pipeline)
{
    if (!pipeline) return;
    pipeline->active = false;
    pipeline->buffering = false;
    pipeline->lead_mute_remaining = 0;
    pipeline->fade_in_remaining = 0;
    audio_ring_buffer_clear(&pipeline->ring_buf);
}
