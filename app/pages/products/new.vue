<script setup lang="ts">
import type { ProductInput } from '~/utils/products'

const { $supabase, $supabaseConfigError } = useNuxtApp()

const saving = ref(false)
const errorMessage = ref($supabase ? '' : ($supabaseConfigError || 'Supabase接続設定が見つかりません'))

const save = async (value: ProductInput) => {
  if (!$supabase || saving.value) return
  saving.value = true
  errorMessage.value = ''
  try {
    // 同じ名前の商品がないか確認
    const { data: same, error: sameError } = await $supabase
      .from('products')
      .select('id, active')
      .eq('name', value.name)
      .limit(1)
    if (sameError) throw sameError
    if (same && same.length) {
      errorMessage.value = same[0].active
        ? `「${value.name}」はすでに登録されています`
        : `「${value.name}」は販売終了の商品にあります。商品管理の「販売終了の商品」から再開してください`
      return
    }

    const { error } = await $supabase.from('products').insert(value)
    if (error) throw error
    await navigateTo({ path: '/products', query: { notice: `「${value.name}」を追加しました` } })
  } catch (error: any) {
    errorMessage.value = error?.message ?? '保存できませんでした'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <main class="page">
    <section class="card">
      <p class="brand">natty note</p>
      <h1>商品を追加</h1>

      <p v-if="errorMessage" class="error" role="alert">{{ errorMessage }}</p>

      <ProductForm submit-label="追加する" :saving="saving" @submit="save" />

      <div class="footer">
        <NuxtLink to="/products" class="back">商品管理へ戻る</NuxtLink>
      </div>
    </section>
  </main>
</template>

<style scoped>
.page { min-height: 100vh; padding: 16px; background: #f6f7f2; color: #243b32; }
.card { max-width: 620px; margin: 0 auto; padding: 24px; background: white; border: 1px solid #dbe3dc; border-radius: 22px; }
.brand { margin: 0 0 12px; font-size: 22px; font-weight: 800; }
h1 { margin: 0 0 20px; font-size: 24px; }
.error { margin: 0 0 16px; padding: 12px; border-radius: 10px; background: #fdecea; color: #b42318; }
.footer { margin-top: 28px; }
.back { display: block; padding: 14px; border-radius: 10px; background: #eef2ee; color: #294638; text-align: center; text-decoration: none; font-weight: 700; }
</style>
