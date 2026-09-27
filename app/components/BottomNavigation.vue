<script setup lang="ts">
// 画面下の固定メニュー。項目を変えるときはこの NAV_ITEMS だけ直せばよい
const NAV_ITEMS = [
  { to: '/', label: 'ホーム', icon: '🏠', match: (p: string) => p === '/' },
  { to: '/posts', label: '投稿', icon: '✨', match: (p: string) => p === '/posts' || p.startsWith('/posts/') },
  { to: '/events', label: '販売予定', icon: '📅', match: (p: string) => p === '/events' || p.startsWith('/events/') },
  { to: '/products', label: '商品', icon: '🍰', match: (p: string) => p === '/products' || p.startsWith('/products/') },
  { to: '/settings', label: '設定', icon: '⚙️', match: (p: string) => p === '/settings' || p.startsWith('/settings/') }
]

const route = useRoute()
// 末尾の / を除いて判定（/events/ と /events を同じ扱いに）
const current = computed(() => route.path.replace(/\/+$/, '') || '/')
</script>

<template>
  <nav class="bottom-nav" aria-label="メインメニュー">
    <ul>
      <li v-for="item in NAV_ITEMS" :key="item.to">
        <NuxtLink
          :to="item.to"
          class="nav-link"
          :class="{ active: item.match(current) }"
          :aria-current="item.match(current) ? 'page' : undefined"
        >
          <span class="icon" aria-hidden="true">{{ item.icon }}</span>
          <span class="label">{{ item.label }}</span>
        </NuxtLink>
      </li>
    </ul>
  </nav>
</template>

<style scoped>
.bottom-nav {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 40;
  padding-bottom: env(safe-area-inset-bottom);
  border-top: 1px solid #dbe3dc;
  background: rgba(255, 255, 255, .97);
  box-shadow: 0 -4px 16px rgba(36, 59, 50, .06);
}

ul {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  max-width: 620px;
  margin: 0 auto;
  padding: 0;
  list-style: none;
}

.nav-link {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-height: var(--nav-height, 64px);
  padding: 6px 2px;
  color: #6b7a71;
  font-size: 12px;
  text-decoration: none;
}

.icon {
  font-size: 20px;
  line-height: 1;
  filter: grayscale(.4);
  opacity: .8;
}

.label {
  font-weight: 600;
  white-space: nowrap;
}

.nav-link.active {
  color: #31694f;
}

.nav-link.active .icon {
  filter: none;
  opacity: 1;
}

.nav-link.active .label {
  font-weight: 800;
}

/* 選択中の項目の上に緑の線 */
.nav-link.active {
  box-shadow: inset 0 3px 0 #31694f;
}

.nav-link:focus-visible {
  outline: 3px solid #91b8a1;
  outline-offset: -3px;
}
</style>
