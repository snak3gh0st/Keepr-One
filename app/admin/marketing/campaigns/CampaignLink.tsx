'use client'

import { useRef, useState } from 'react'
import { Button } from '@/components/Button'
import { useI18n } from '@/components/i18n/LanguageProvider'
import styles from './campaigns.module.css'

export function CampaignLink({ path }: { path: string }) {
  const { copy } = useI18n()
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle')
  const [manualUrl, setManualUrl] = useState('')
  const manualInput = useRef<HTMLInputElement>(null)

  async function copyLink() {
    const url = new URL(path, window.location.origin).href
    try {
      await navigator.clipboard.writeText(url)
      setState('copied')
    } catch {
      setManualUrl(url)
      setState('manual')
      requestAnimationFrame(() => { manualInput.current?.focus(); manualInput.current?.select() })
    }
  }

  return (
    <section className={`${styles.panel} ${styles.capture}`} aria-labelledby="campaign-capture-heading">
      <h2 id="campaign-capture-heading" className={styles.heading}>{copy('Link de captação', 'Lead capture link')}</h2>
      <p className={styles.description}>{copy('Use este link na divulgação. Cada novo cadastro será vinculado a esta campanha.', 'Use this link in your promotion. Each new signup will be attributed to this campaign.')}</p>
      <code className={styles.capturePath}>{path}</code>
      <div className={styles.captureActions}>
        <Button type="button" variant="primary" onClick={copyLink}>{state === 'copied' ? copy('Link copiado', 'Link copied') : copy('Copiar link', 'Copy link')}</Button>
        <a href={path} target="_blank" rel="noopener noreferrer" className={styles.textLink}>
          {copy('Abrir página', 'Open page')}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden><path d="M14 4h6v6M20 4l-9 9M10 4H4v16h16v-6" /></svg>
          <span className="sr-only">{copy('(abre em nova aba)', '(opens in a new tab)')}</span>
        </a>
      </div>
      <p className={styles.copyFeedback} role="status">
        {state === 'copied' ? copy('Link completo copiado. Pronto para compartilhar.', 'Full link copied. Ready to share.') : state === 'manual' ? copy('O navegador não permitiu copiar. Selecione e copie o link abaixo.', 'Your browser could not copy the link. Select and copy it below.') : copy('Destino: cadastro Founders da Keepr One.', 'Destination: the Keepr One Founders signup.')}
      </p>
      {state === 'manual' ? (
        <div className={`${styles.field} ${styles.manualCopy}`}>
          <label htmlFor="campaign-manual-link" className={styles.label}>{copy('Link completo', 'Full link')}</label>
          <input ref={manualInput} id="campaign-manual-link" readOnly value={manualUrl} className={styles.input} onFocus={(event) => event.currentTarget.select()} />
        </div>
      ) : null}
    </section>
  )
}
