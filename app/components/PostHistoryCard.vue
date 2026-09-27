<script setup lang="ts">
// 投稿履歴カード（表示のみ。編集はしない）
// compact: /posts の「最近の投稿」用（本文を3行で省略・小さいサムネイル）
import { historyDate, historyStatusLabel, platformLabel, postTypeLabel, type HistoryPost } from '~/utils/postHistory'
import { isRealXPostId, xPostUrl } from '~/utils/xAccount'

const props = withDefaults(defineProps<{
  post: HistoryPost
  xUsername?: string | null
  compact?: boolean
  full?: boolean
}>(), { xUsername: null, compact: false, full: false })

const xLink = computed(() =>
  props.post.platform === 'x' && isRealXPostId(props.post.external_post_id)
    ? xPostUrl(props.post.external_post_id, props.xUsername)
    : ''
)
</script>

<template>
  <article class="post" :class="{ compact }">
    <div class="top">
      <span class="platform" :class="`pf-${post.platform}`">{{ platformLabel(post.platform) }}</span>
      <span class="status" :class="`st-${post.status}`">{{ historyStatusLabel(post.status) }}</span>
      <span v-if="!compact" class="type">{{ postTypeLabel(post.post_type) }}</span>
      <span v-if="!compact && post.generated_by_ai" class="ai">AIで作成</span>
    </div>

    <div class="main">
      <div class="text">
        <p v-if="post.productName" class="product">{{ post.productName }}</p>
        <p class="content" :class="{ clamp: !full, 'clamp-short': compact }">{{ post.content }}</p>
        <p class="date">{{ historyDate(post) }}<span v-if="post.status === 'approved'" class="date-note">（準備した日時）</span></p>
      </div>
      <img v-if="post.photoUrl && !full" :src="post.photoUrl" alt="投稿の写真" class="thumb" loading="lazy">
    </div>

    <div v-if="!full || xLink" class="actions">
      <NuxtLink v-if="!full" :to="`/posts/history/${post.id}`" class="button">詳しく見る</NuxtLink>
      <a v-if="xLink" :href="xLink" target="_blank" rel="noopener noreferrer" class="button x">Xで見る</a>
    </div>
  </article>
</template>

<style scoped>
.post { padding: 16px; border: 1px solid #dbe3dc; border-radius: 14px; background: white; color: #243b32; min-width: 0; }
.top { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.platform { padding: 2px 10px; border-radius: 999px; background: #eef2ee; font-size: 13px; font-weight: 800; }
.pf-x { background: #111; color: white; }
.status { padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; }
.st-posted { background: #e3efe7; color: #31694f; }
.st-approved { background: #fff1d6; color: #8a5a00; }
.type { font-size: 12px; opacity: .75; }
.ai { padding: 1px 8px; border: 1px solid #b9cfc1; border-radius: 999px; font-size: 11px; color: #31694f; }

.main { display: flex; gap: 12px; margin-top: 10px; }
.text { flex: 1; min-width: 0; }
.product { margin: 0 0 4px; font-size: 16px; font-weight: 700; overflow-wrap: anywhere; }
.content { margin: 0; font-size: 14px; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; }
.clamp { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; line-clamp: 4; overflow: hidden; }
.clamp-short { -webkit-line-clamp: 3; line-clamp: 3; }
.date { margin: 8px 0 0; font-size: 13px; opacity: .7; }
.date-note { font-size: 11px; }
.thumb { flex-shrink: 0; width: 88px; height: 88px; object-fit: cover; border-radius: 10px; background: #f6f7f2; }
.compact .thumb { width: 64px; height: 64px; }

.actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.button { flex: 1; min-width: 120px; min-height: 44px; display: flex; align-items: center; justify-content: center; padding: 10px 14px; border-radius: 10px; background: #eef2ee; color: #294638; font-weight: 700; text-decoration: none; }
.button.x { background: #111; color: white; }
a:focus-visible { outline: 3px solid #91b8a1; outline-offset: 2px; }
</style>
