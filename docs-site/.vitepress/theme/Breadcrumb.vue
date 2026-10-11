<script setup lang="ts">
import { computed } from 'vue'
import { useData } from 'vitepress'

interface SidebarItem {
  text?: string
  link?: string
  items?: SidebarItem[]
}

const { page, theme } = useData()

// Match sidebar links against the current page: strip .md, /index and the
// trailing slash so '/en/' and 'en/index.md' normalize to the same key.
const normalize = (link: string) =>
  link
    .replace(/\.md$/, '')
    .replace(/\/index$/, '')
    .replace(/\/$/, '') || '/'

const crumbs = computed(() => {
  const sidebar = theme.value.sidebar as SidebarItem[] | undefined
  if (!Array.isArray(sidebar)) return []
  const target = normalize('/' + page.value.relativePath)
  const find = (items: SidebarItem[]): string | null => {
    for (const item of items) {
      if (item.link && normalize(item.link) === target) return item.text ?? null
      if (item.items) {
        const hit = find(item.items)
        if (hit) return hit
      }
    }
    return null
  }
  for (const group of sidebar) {
    const hit = group.items ? find(group.items) : null
    if (hit) return [group.text ?? '', hit]
  }
  return []
})
</script>

<template>
  <nav v-if="crumbs.length === 2" class="vp-breadcrumb" aria-label="Breadcrumb">
    <span>{{ crumbs[0] }}</span>
    <span class="sep" aria-hidden="true">›</span>
    <span class="current">{{ crumbs[1] }}</span>
  </nav>
</template>

<style scoped>
.vp-breadcrumb {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 14px;
  color: var(--vp-c-text-2);
  margin-bottom: 8px;
}

.sep {
  opacity: 0.6;
}

.current {
  color: var(--vp-c-text-3);
}
</style>
