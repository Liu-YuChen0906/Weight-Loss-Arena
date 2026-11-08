<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { X } from 'lucide-vue-next'
defineProps<{ title: string; compact?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLElement>()
let previous: HTMLElement | null = null
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
  if (event.key !== 'Tab') return
  const elements = dialog.value?.querySelectorAll<HTMLElement>(
    'button:not(:disabled),a,input,textarea,select,[tabindex="0"]',
  )
  if (!elements?.length) {
    event.preventDefault()
    return
  }
  const first = elements[0],
    last = elements[elements.length - 1]
  if (
    event.shiftKey &&
    (document.activeElement === first || document.activeElement === dialog.value)
  ) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}
onMounted(() => {
  previous = document.activeElement as HTMLElement
  document.body.style.overflow = 'hidden'
  dialog.value?.focus()
  document.addEventListener('keydown', keydown)
})
onBeforeUnmount(() => {
  document.body.style.overflow = ''
  document.removeEventListener('keydown', keydown)
  previous?.focus()
})
</script>
<template>
  <Teleport to="body">
    <div
      class="scrim"
      @click.self="emit('close')"
    >
      <section
        ref="dialog"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
        tabindex="-1"
        :class="['sheet', { compact }]"
      >
        <header>
          <h2>{{ title }}</h2>
          <button
            class="icon-button"
            aria-label="关闭"
            @click="emit('close')"
          >
            <X :size="21" />
          </button>
        </header>
        <div class="sheet-content"><slot /></div>
      </section>
    </div>
  </Teleport>
</template>
