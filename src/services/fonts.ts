// verified woff (troika/drei Text cannot read woff2): jsDelivr npm mirror of Pretendard
export const PRETENDARD_WOFF = 'https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/static/woff/Pretendard-Regular.woff'
export const JONES_BOOK_OTF = '/fonts/Jones-Book.otf'
export const CANVAS_UI_FONT = '"Jones UI", "Pretendard Variable", Pretendard, sans-serif'

export const loadCanvasFonts = () => Promise.all([
  document.fonts.load('400 16px "Jones UI"'),
  document.fonts.load('700 16px "Jones UI"'),
])
