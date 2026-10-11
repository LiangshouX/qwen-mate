import { h } from 'vue'
import DefaultTheme from 'vitepress/theme'
import Breadcrumb from './Breadcrumb.vue'

export default {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      'doc-before': () => h(Breadcrumb)
    })
}
