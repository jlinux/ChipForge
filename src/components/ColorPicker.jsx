import React from 'react'

export default function ColorPicker({ label, color, onChange }) {
  return (
    <div className="color-row">
      <div className="color-swatch" style={{ backgroundColor: color }}>
        <input
          type="color"
          value={color}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      <span className="color-label">{label}</span>
      <span className="color-hex">{color}</span>
    </div>
  )
}
