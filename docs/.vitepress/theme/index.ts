import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import DocScreenshot from './DocScreenshot.vue'
import FeatureExplorer from './FeatureExplorer.vue'
import './custom.css'
export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('DocScreenshot', DocScreenshot)
    app.component('FeatureExplorer', FeatureExplorer)
  },
} satisfies Theme
