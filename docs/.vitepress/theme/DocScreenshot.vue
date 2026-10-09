<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useData, useRoute, withBase } from 'vitepress'

const props = defineProps<{ src: string; alt: string }>()
const { lang } = useData()
const route = useRoute()
const viewer = ref<HTMLDialogElement>()
const trigger = ref<HTMLButtonElement>()
const originalSize = ref(false)
let previousOverflow: string | undefined
const copy = computed(() => lang.value === 'en' ? {
  open: 'Enlarge screenshot', hint: 'Click to enlarge', close: 'Close screenshot',
  original: 'Original size', fit: 'Fit to screen',
} : lang.value === 'zh-Hans' ? {
  open: '放大画面', hint: '点击放大', close: '关闭画面', original: '原始尺寸', fit: '适应屏幕',
} : {
  open: '放大畫面', hint: '點擊放大', close: '關閉畫面', original: '原始尺寸', fit: '符合螢幕',
})
const source = computed(() => withBase(props.src))

function open() {
  if (!viewer.value || viewer.value.open) return
  originalSize.value = false
  previousOverflow = document.documentElement.style.overflow
  viewer.value.showModal()
  document.documentElement.style.overflow = 'hidden'
}
function restore() {
  if (previousOverflow !== undefined) {
    document.documentElement.style.overflow = previousOverflow
    previousOverflow = undefined
    trigger.value?.focus({ preventScroll: true })
  }
}
function close() {
  viewer.value?.close()
  restore()
}
watch(() => route.path, close)
onBeforeUnmount(close)
</script>

<template>
  <span class="doc-screenshot" role="figure" :aria-label="alt">
    <button ref="trigger" class="screenshot-trigger" type="button" :aria-label="`${copy.open}: ${alt}`" @click="open">
      <img :src="source" :alt="alt" width="1400" height="900" decoding="async">
    </button>
    <span class="screenshot-caption"><span>{{ alt }}</span><span class="screenshot-hint">{{ copy.hint }}</span></span>
    <ClientOnly><Teleport to="body">
    <dialog ref="viewer" class="screenshot-viewer" :aria-label="alt" @close="restore" @click="event => { if (event.target === viewer) close() }">
      <div class="screenshot-toolbar">
        <span>{{ alt }}</span>
        <button type="button" @click="originalSize = !originalSize">{{ originalSize ? copy.fit : copy.original }}</button>
        <button type="button" class="screenshot-close" @click="close">{{ copy.close }} <span aria-hidden="true">×</span></button>
      </div>
      <div class="screenshot-canvas" :class="{ 'original-size': originalSize }">
        <img :src="source" :alt="alt" width="1400" height="900">
      </div>
    </dialog>
    </Teleport></ClientOnly>
  </span>
</template>
