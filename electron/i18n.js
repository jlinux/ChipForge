const messages = {
  'zh-CN': {
    selectSaveLocation: '选择保存位置',
    selectFontFile: '选择字体文件',
    fontFiles: '字体文件',
    body: '主体',
    nameText: '正面文字',
    valueText: '背面文字',
    grooves: '边缘凹槽',
    rimRing: '边框环',
  },
  en: {
    selectSaveLocation: 'Select Output Folder',
    selectFontFile: 'Select Font File',
    fontFiles: 'Font Files',
    body: 'Body',
    nameText: 'Front Text',
    valueText: 'Back Text',
    grooves: 'Edge Cylinders',
    rimRing: 'Rim Ring',
  },
}

function normalizeLocale(locale) {
  return locale === 'zh-CN' ? 'zh-CN' : 'en'
}

function t(locale, key) {
  const normalized = normalizeLocale(locale)
  return messages[normalized]?.[key] || messages.en[key] || key
}

module.exports = {
  normalizeLocale,
  t,
}
