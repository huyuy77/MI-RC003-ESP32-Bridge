#pragma once

#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    int16_t *buffer;
    size_t   capacity;      // Must be power of 2
    size_t   mask;          // capacity - 1
    volatile size_t head;   // Write index
    volatile size_t tail;   // Read index
} audio_ring_buffer_t;

bool audio_ring_buffer_init(audio_ring_buffer_t *rb, int16_t *storage, size_t capacity);
size_t audio_ring_buffer_available_read(const audio_ring_buffer_t *rb);
size_t audio_ring_buffer_available_write(const audio_ring_buffer_t *rb);
size_t audio_ring_buffer_write(audio_ring_buffer_t *rb, const int16_t *samples, size_t count);
size_t audio_ring_buffer_read(audio_ring_buffer_t *rb, int16_t *out_samples, size_t count);
void audio_ring_buffer_clear(audio_ring_buffer_t *rb);

#ifdef __cplusplus
}
#endif
