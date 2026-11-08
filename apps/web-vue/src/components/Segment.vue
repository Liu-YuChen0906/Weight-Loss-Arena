<script setup lang="ts">
defineProps<{
  modelValue: string | number
  options: { value: string | number; label: string }[]
  label: string
}>()
defineEmits<{ 'update:modelValue': [value: string | number] }>()
</script>
<template>
  <div
    class="segment"
    role="group"
    :aria-label="label"
  >
    <span
      class="segment-track"
      :style="{
        width: `${100 / options.length}%`,
        transform: `translateX(${
          Math.max(
            0,
            options.findIndex((o) => o.value === modelValue),
          ) * 100
        }%)`,
      }"
    ></span>
    <button
      v-for="option in options"
      :key="option.value"
      :class="{ selected: modelValue === option.value }"
      :aria-pressed="modelValue === option.value"
      @click="$emit('update:modelValue', option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>
