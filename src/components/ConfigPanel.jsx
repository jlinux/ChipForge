import React from 'react'
import ColorPicker from './ColorPicker'

const COLOR_PARTS = [
  { key: 'body', label: '主体' },
  { key: 'nameText', label: '正面文字' },
  { key: 'valueText', label: '背面文字' },
  { key: 'grooves', label: '边缘凹槽' },
  { key: 'rimRing', label: '边框环' },
]

export default function ConfigPanel({
  config,
  onChange,
  onExport,
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
    const fontPath = await window.electronAPI.selectFont()
    if (fontPath) update('fontPath', fontPath)
  }

  return (
    <div>
      <div className="panel-title">筹码生成器</div>

      <div className="config-section">
        <h3>文字设置</h3>
        <div className="field">
          <label>姓名（正面）</label>
          <input
            type="text"
            value={config.name}
            onChange={(e) => update('name', e.target.value)}
            placeholder="输入姓名"
          />
        </div>
        <div className="field">
          <label>面值（背面）</label>
          <input
            type="text"
            value={config.value}
            onChange={(e) => update('value', e.target.value)}
            placeholder="输入面值"
          />
        </div>
      </div>

      <div className="config-section">
        <h3>风格</h3>
        <div className="style-toggle">
          <button
            className={`style-btn ${config.style === 'classic' ? 'active' : ''}`}
            onClick={() => update('style', 'classic')}
          >
            经典
          </button>
          <button
            className={`style-btn ${config.style === 'minimal' ? 'active' : ''}`}
            onClick={() => update('style', 'minimal')}
          >
            简约
          </button>
        </div>
      </div>

      <div className="config-section">
        <h3>尺寸参数</h3>
        <div className="field">
          <label>
            直径 <span className="range-value">{config.diameter}mm</span>
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
            厚度 <span className="range-value">{config.thickness}mm</span>
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
            文字深度 <span className="range-value">{config.textDepth}mm</span>
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
                凹槽数量 <span className="range-value">{config.grooveCount}</span>
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
                凹槽半径 <span className="range-value">{config.grooveRadius}mm</span>
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
            边框环宽度 <span className="range-value">{config.rimWidth}mm</span>
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
        <h3>颜色配置</h3>
        <div className="color-grid">
          {COLOR_PARTS.map(({ key, label }) => {
            if (key === 'grooves' && config.style !== 'classic') return null
            return (
              <ColorPicker
                key={key}
                label={label}
                color={config.colors[key]}
                onChange={(color) => updateColor(key, color)}
              />
            )
          })}
        </div>
      </div>

      <div className="config-section">
        <h3>字体</h3>
        <div className="font-selector">
          <span className="font-name">
            {config.fontPath
              ? config.fontPath.split('/').pop()
              : 'Noto Sans SC（内置）'}
          </span>
          <button className="btn btn-secondary" onClick={handleSelectFont}>
            选择
          </button>
          {config.fontPath && (
            <button
              className="btn btn-secondary"
              onClick={() => update('fontPath', null)}
            >
              重置
            </button>
          )}
        </div>
      </div>

      <div className="config-section">
        <h3>输出目录</h3>
        <div className="font-selector">
          <span className="font-name">
            {exportDir || '未设置，首次导出时会提示选择'}
          </span>
          <button className="btn btn-secondary" onClick={onSelectExportDir}>
            选择
          </button>
        </div>
        <div className="export-hint">
          选择一次后会自动记住，后续导出不再重复询问
        </div>
      </div>

      <div className="config-section">
        <h3>导出</h3>
        <div className="export-buttons">
          <button
            className="btn btn-primary"
            disabled={exporting}
            onClick={() => onExport('multi')}
          >
            导出 3MF + STL（多色打印）
          </button>
          <button
            className="btn btn-secondary"
            disabled={exporting}
            onClick={() => onExport('single')}
          >
            导出合体 STL（单色打印）
          </button>
        </div>
        <div className="export-hint">
          3MF 文件可直接导入 Bambu Studio，自带颜色分配
        </div>
        {progress && (
          <div>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <div className="progress-text">
              {progress.stage === 'generating' && '生成几何体...'}
              {progress.stage === 'exporting' && `导出 ${progress.file || ''}...`}
              {progress.stage === 'combining' && '生成合体版...'}
              {progress.stage === 'done' && '完成！'}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
