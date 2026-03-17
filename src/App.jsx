import React, { useEffect, useState } from 'react'
import ConfigPanel from './components/ConfigPanel'
import ChipPreview from './components/ChipPreview'
import { createTranslator } from './i18n'

const DEFAULT_CONFIG = {
  name: 'Player',
  value: '1000',
  style: 'classic',
  diameter: 40,
  thickness: 3.2,
  textDepth: 0.6,
  grooveCount: 24,
  grooveRadius: 1.5,
  rimWidth: 1.5,
  colors: {
    body: '#FFFFFF',
    nameText: '#C0392B',
    valueText: '#2C3E50',
    grooves: '#E74C3C',
    rimRing: '#F39C12',
  },
  fontPath: null,
}

export default function App() {
  const [config, setConfig] = useState(DEFAULT_CONFIG)
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState(null)
  const [exportDir, setExportDir] = useState(null)
  const [locale, setLocale] = useState('en')
  const t = createTranslator(locale)

  useEffect(() => {
    const savedLocale = window.localStorage.getItem('chipforge-locale')
    if (savedLocale === 'zh-CN' || savedLocale === 'en') {
      setLocale(savedLocale)
    } else if (navigator.language.toLowerCase().startsWith('zh')) {
      setLocale('zh-CN')
    }

    if (!window.electronAPI?.getExportDir) return
    window.electronAPI.getExportDir().then(setExportDir).catch(() => {})
  }, [])

  const handleLocaleChange = (nextLocale) => {
    setLocale(nextLocale)
    window.localStorage.setItem('chipforge-locale', nextLocale)
  }

  const handleSelectExportDir = async () => {
    if (!window.electronAPI?.selectExportDir) return
    const dir = await window.electronAPI.selectExportDir()
    if (dir) setExportDir(dir)
  }

  const handleExport = async (mode) => {
    if (!window.electronAPI) {
      alert(t('electronOnly'))
      return
    }
    setExporting(true)
    setProgress({ stage: 'starting', percent: 0 })

    window.electronAPI.onProgress((p) => setProgress(p))

    try {
      const result = await window.electronAPI.generateSTL({
        ...config,
        exportMode: mode,
      })
      if (result.success) {
        setExportDir(result.outputDir)
        alert(t('exportSuccess', { outputDir: result.outputDir }))
      } else if (result.reason !== 'canceled') {
        alert(t('exportFailed', { reason: result.reason }))
      }
    } catch (err) {
      alert(t('exportError', { message: err.message }))
    } finally {
      setExporting(false)
      setProgress(null)
    }
  }

  return (
    <div className="app">
      <div className="panel">
        <ConfigPanel
          config={config}
          onChange={setConfig}
          onExport={handleExport}
          locale={locale}
          onLocaleChange={handleLocaleChange}
          t={t}
          exportDir={exportDir}
          onSelectExportDir={handleSelectExportDir}
          exporting={exporting}
          progress={progress}
        />
      </div>
      <div className="preview">
        <ChipPreview config={config} />
      </div>
    </div>
  )
}
