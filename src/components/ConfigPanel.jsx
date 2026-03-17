import React from 'react'
import ColorPicker from './ColorPicker'

const COLOR_PARTS = ['body', 'nameText', 'valueText', 'grooves', 'rimRing']

export default function ConfigPanel({
  config,
  onChange,
  onExport,
  locale,
  onLocaleChange,
  t,
  exportDir,
  onSelectExportDir,
  exporting,
  progress,
}) {
  const update = (key, value) => {
    onChange({ ...config, [key]: value })
  }

  const updateColor = (part, color) => {
    onChange({
      ...config,
      colors: { ...config.colors, [part]: color },
    })
  }

  const handleSelectFont = async () => {
    if (!window.electronAPI) return
    const fontPath = await window.electronAPI.selectFont(locale)
    if (fontPath) update('fontPath', fontPath)
  }

  return (
    <div>
      <div className="panel-header">
        <div className="panel-title">{t('appTitle')}</div>
        <div className="style-toggle lang-toggle">
          <button
            className={`style-btn ${locale === 'zh-CN' ? 'active' : ''}`}
            onClick={() => onLocaleChange('zh-CN')}
          >
            {t('chinese')}
          </button>
          <button
            className={`style-btn ${locale === 'en' ? 'active' : ''}`}
            onClick={() => onLocaleChange('en')}
          >
            {t('english')}
          </button>
        </div>
      </div>

      <div className="config-section">
        <h3>{t('textSettings')}</h3>
        <div className="field">
          <label>{t('frontName')}</label>
          <input
            type="text"
            value={config.name}
            onChange={(e) => update('name', e.target.value)}
            placeholder={t('enterName')}
          />
        </div>
        <div className="field">
          <label>{t('backValue')}</label>
          <input
            type="text"
            value={config.value}
            onChange={(e) => update('value', e.target.value)}
            placeholder={t('enterValue')}
          />
        </div>
      </div>

      <div className="config-section">
        <h3>{t('style')}</h3>
        <div className="style-toggle">
          <button
            className={`style-btn ${config.style === 'classic' ? 'active' : ''}`}
            onClick={() => update('style', 'classic')}
          >
            {t('classic')}
          </button>
          <button
            className={`style-btn ${config.style === 'minimal' ? 'active' : ''}`}
            onClick={() => update('style', 'minimal')}
          >
            {t('minimal')}
          </button>
        </div>
      </div>

      <div className="config-section">
        <h3>{t('dimensions')}</h3>
        <div className="field">
          <label>
            {t('diameter')} <span className="range-value">{config.diameter}mm</span>
          </label>
          <input
            type="range"
            min="30"
            max="50"
            step="0.5"
            value={config.diameter}
            onChange={(e) => update('diameter', parseFloat(e.target.value))}
          />
        </div>
        <div className="field">
          <label>
            {t('thickness')} <span className="range-value">{config.thickness}mm</span>
          </label>
          <input
            type="range"
            min="2"
            max="5"
            step="0.1"
            value={config.thickness}
            onChange={(e) => update('thickness', parseFloat(e.target.value))}
          />
        </div>
        <div className="field">
          <label>
            {t('textDepth')} <span className="range-value">{config.textDepth}mm</span>
          </label>
          <input
            type="range"
            min="0.2"
            max="1.5"
            step="0.1"
            value={config.textDepth}
            onChange={(e) => update('textDepth', parseFloat(e.target.value))}
          />
        </div>
        {config.style === 'classic' && (
          <>
            <div className="field">
              <label>
                {t('grooveCount')} <span className="range-value">{config.grooveCount}</span>
              </label>
              <input
                type="range"
                min="8"
                max="40"
                step="1"
                value={config.grooveCount}
                onChange={(e) => update('grooveCount', parseInt(e.target.value))}
              />
            </div>
            <div className="field">
              <label>
                {t('grooveRadius')} <span className="range-value">{config.grooveRadius}mm</span>
              </label>
              <input
                type="range"
                min="0.5"
                max="3"
                step="0.1"
                value={config.grooveRadius}
                onChange={(e) => update('grooveRadius', parseFloat(e.target.value))}
              />
            </div>
          </>
        )}
        <div className="field">
          <label>
            {t('rimWidth')} <span className="range-value">{config.rimWidth}mm</span>
          </label>
          <input
            type="range"
            min="0.5"
            max="3"
            step="0.1"
            value={config.rimWidth}
            onChange={(e) => update('rimWidth', parseFloat(e.target.value))}
          />
        </div>
      </div>

      <div className="config-section">
        <h3>{t('colors')}</h3>
        <div className="color-grid">
          {COLOR_PARTS.map((key) => {
            if (key === 'grooves' && config.style !== 'classic') return null
            return (
              <ColorPicker
                key={key}
                label={t(key)}
                color={config.colors[key]}
                onChange={(color) => updateColor(key, color)}
              />
            )
          })}
        </div>
      </div>

      <div className="config-section">
        <h3>{t('font')}</h3>
        <div className="font-selector">
          <span className="font-name">
            {config.fontPath
              ? config.fontPath.split('/').pop()
              : t('builtInFont')}
          </span>
          <button className="btn btn-secondary" onClick={handleSelectFont}>
            {t('choose')}
          </button>
          {config.fontPath && (
            <button
              className="btn btn-secondary"
              onClick={() => update('fontPath', null)}
            >
              {t('reset')}
            </button>
          )}
        </div>
      </div>

      <div className="config-section">
        <h3>{t('outputDir')}</h3>
        <div className="font-selector">
          <span className="font-name">
            {exportDir || t('exportDirUnset')}
          </span>
          <button className="btn btn-secondary" onClick={onSelectExportDir}>
            {t('choose')}
          </button>
        </div>
        <div className="export-hint">{t('exportDirHint')}</div>
      </div>

      <div className="config-section">
        <h3>{t('export')}</h3>
        <div className="export-buttons">
          <button
            className="btn btn-primary"
            disabled={exporting}
            onClick={() => onExport('multi')}
          >
            {t('exportMulti')}
          </button>
          <button
            className="btn btn-secondary"
            disabled={exporting}
            onClick={() => onExport('single')}
          >
            {t('exportSingle')}
          </button>
        </div>
        <div className="export-hint">{t('exportHint')}</div>
        {progress && (
          <div>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <div className="progress-text">
              {progress.stage === 'generating' && (
                progress.detail
                  ? t('generatingDetail', { detail: progress.detail })
                  : t('generating')
              )}
              {progress.stage === 'exporting' && t('exportingFile', { file: progress.file || '' })}
              {progress.stage === 'combining' && t('combining')}
              {progress.stage === 'done' && t('done')}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
