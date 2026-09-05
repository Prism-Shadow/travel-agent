import { welcomeStrings, type WelcomeLanguage } from './welcome-strings'

const storageKey = 'travelBrowser.welcomeLanguage'
const languageButtons = document.querySelectorAll<HTMLButtonElement>('[data-language]')

function initialLanguage(): WelcomeLanguage {
  try {
    const saved = localStorage.getItem(storageKey)
    if (saved === 'en' || saved === 'zh') return saved
  } catch {
    // The page still works when the browser does not allow local preference storage.
  }
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

function showLanguage(language: WelcomeLanguage): void {
  const strings = welcomeStrings[language]
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'
  document.title = strings.pageTitle
  for (const [attribute, target] of [
    ['data-i18n', null],
    ['data-i18n-aria', 'aria-label'],
  ] as const) {
    for (const element of document.querySelectorAll<HTMLElement>(`[${attribute}]`)) {
      const key = element.getAttribute(attribute) as keyof typeof strings
      if (!(key in strings)) continue
      if (target) element.setAttribute(target, strings[key])
      else element.textContent = strings[key]
    }
  }
  for (const button of languageButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.language === language))
  }
}

for (const button of languageButtons) {
  button.addEventListener('click', () => {
    const language = button.dataset.language
    if (language !== 'en' && language !== 'zh') return
    showLanguage(language)
    try {
      localStorage.setItem(storageKey, language)
    } catch {
      // Changing the current page's language does not depend on persistence.
    }
  })
}
showLanguage(initialLanguage())
