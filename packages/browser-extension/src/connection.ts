import { connectionStrings } from './connection-strings'
import type { ConnectionChoice } from './desktop-connection'
import type { DesktopIdentity } from 'penguin-browser/src/shared/desktop-connection'

const zh = navigator.language.toLowerCase().startsWith('zh')
const text = connectionStrings[zh ? 'zh' : 'en']
document.documentElement.lang = zh ? 'zh-CN' : 'en'
const element = (id: string) => document.getElementById(id)!
for (const [id, label] of Object.entries({ heading: text.heading, description: text.description,
  'status-heading': text.status, refresh: text.refresh, 'developer-heading': text.standalone,
  'developer-description': text.developer, standalone: text.useStandalone })) element(id).textContent = label

async function refresh(choice?: ConnectionChoice): Promise<void> {
  const buttons = document.querySelectorAll<HTMLButtonElement>('button')
  buttons.forEach(button => { button.disabled = true })
  try {
    const result = await chrome.runtime.sendMessage({ action: choice ? 'connectionChoose' : 'connectionStatus', choice }) as {
      connected?: boolean; application?: string; choice?: ConnectionChoice; apps?: DesktopIdentity[]; discoveryError?: string; error?: string;
    }
    const status = result.connected ? `${text.connected} ${result.application ?? text.standalone}`
      : result.choice?.mode === 'desktop' && result.choice.installationId ? text.waiting : text.unpaired
    element('status').textContent = status
    element('error').textContent = result.error?.startsWith('Close the connected') ? text.pairing
      : result.discoveryError && !result.connected ? text.helper : result.error ?? ''
    element('applications').replaceChildren()
    for (const app of result.apps ?? []) {
      const button = document.createElement('button')
      const paired = result.choice?.mode === 'desktop' && result.choice.installationId === app.installationId
      button.textContent = `${paired ? text.paired : text.choose} · ${app.name} · ${app.installationId.slice(0, 6)}`
      button.addEventListener('click', () => void refresh({ mode: 'desktop', installationId: app.installationId }))
      element('applications').append(button)
    }
  } catch { element('error').textContent = text.helper }
  finally { buttons.forEach(button => { button.disabled = false }) }
}
element('refresh').addEventListener('click', () => void refresh())
element('standalone').addEventListener('click', () => void refresh({ mode: 'standalone' }))
void refresh()
