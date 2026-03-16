import React, { useState } from 'react'
import ConfigPanel from './components/ConfigPanel'
import ChipPreview from './components/ChipPreview'

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

  const handleExport = async (mode) => {
    if (!window.electronAPI) {
      alert('STL 导出仅在 Electron 环境中可用')
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
        alert(`导出成功！\n保存位置：${result.outputDir}`)
      } else if (result.reason !== 'canceled') {
        alert(`导出失败：${result.reason}`)
      }
    } catch (err) {
      alert(`导出错误：${err.message}`)
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
