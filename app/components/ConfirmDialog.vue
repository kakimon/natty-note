<script setup lang="ts">
// 画面内に出す確認ダイアログ（ブラウザ標準の confirm は使わない）
defineProps<{
  title: string
  message?: string
  confirmLabel: string
  busy?: boolean
  danger?: boolean
}>()
const emit = defineEmits<{ confirm: []; cancel: [] }>()
</script>

<template>
  <div class="overlay" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
    <div class="dialog">
      <p id="confirm-title" class="title">{{ title }}</p>
      <p v-if="message" class="message">{{ message }}</p>
      <div class="buttons">
        <button type="button" class="cancel" :disabled="busy" @click="emit('cancel')">キャンセル</button>
        <button
          type="button"
          class="ok"
          :class="{ danger }"
          :disabled="busy"
          @click="emit('confirm')"
        >
          {{ busy ? '処理中...' : confirmLabel }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay { position: fixed; inset: 0; z-index: 50; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(0, 0, 0, .4); }
.dialog { width: 100%; max-width: 420px; padding: 24px; border-radius: 18px; background: white; color: #243b32; }
.title { margin: 0 0 8px; font-size: 18px; font-weight: 700; overflow-wrap: anywhere; }
.message { margin: 0; line-height: 1.7; white-space: pre-line; }
.buttons { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 20px; }
button { min-height: 50px; border: 0; border-radius: 12px; font: inherit; font-weight: 700; cursor: pointer; }
button:disabled { opacity: .5; cursor: wait; }
.cancel { background: #eef2ee; color: #294638; }
.ok { background: #31694f; color: white; }
.ok.danger { background: #b42318; }
button:focus-visible { outline: 3px solid #91b8a1; outline-offset: 2px; }
</style>
