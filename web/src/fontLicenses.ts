import { getLocale, setLocale, subscribe, t, type Locale } from './i18n/runtime'
const selector = document.querySelector<HTMLSelectElement>('#language')!
function render() {
  document.title = `Infinite Reader · ${t('Font licenses')}`
  document.querySelectorAll<HTMLElement>('[data-message]').forEach(element => { element.textContent = t(element.dataset.message!) })
  selector.value = getLocale()
  selector.setAttribute('aria-label', t('界面语言'))
}
selector.addEventListener('change', () => setLocale(selector.value as Locale))
subscribe(render)
render()
