import { useEffect, useRef, useState } from 'react'
import { clampModelScale, type CustomObjectSpec } from '../customObjectSpec'
import { useRoomStore } from '../store'
import { t } from '../services/i18n'

const AXES = [['X', '폭'], ['Y', '높이'], ['Z', '깊이']] as const

export default function CustomSizeEditor() {
  const { customEditing, updateCustomObjectEdit, applyCustomObjectEdit, cancelCustomObjectEdit, preview, selectedPlacementValid, previewValid } = useRoomStore()
  const initial = useRef<CustomObjectSpec | null>(null)
  const [locked, setLocked] = useState(true)
  useEffect(() => { initial.current = customEditing; setLocked(true) }, [customEditing?.id])
  if (!customEditing) return null
  const scale = clampModelScale(customEditing.modelScale)
  const valid = preview ? previewValid : selectedPlacementValid
  const changeScale = (axis: number, value: number) => {
    const next = Math.max(.25, Math.min(1, value))
    updateCustomObjectEdit({ modelScale: locked ? [next, next, next] : scale.map((part, index) => index === axis ? next : part) as [number, number, number] })
  }
  const changeFootprint = (axis: 'width' | 'depth', value: number) => updateCustomObjectEdit({ footprint: { ...customEditing.footprint, [axis]: Math.max(1, Math.min(10, Math.round(value || 1))) } })
  const reset = () => {
    const value = initial.current; if (!value) return
    updateCustomObjectEdit({ name: value.name, footprint: value.footprint, modelScale: value.modelScale ?? [1, 1, 1] })
  }
  return <section className="custom-size-editor" aria-label={t('모델 크기 수정')} onPointerDown={(event) => event.stopPropagation()}>
    <input className="custom-size-name" maxLength={40} value={customEditing.name} aria-label={t('이름 수정')} onChange={(event) => updateCustomObjectEdit({ name: event.target.value })} />
    <div className="custom-footprint-edit"><span>{t('차지 칸')}</span><input type="number" min={1} max={10} value={customEditing.footprint.width} aria-label={t('가로')} onChange={(event) => changeFootprint('width', Number(event.target.value))} /><span>×</span><input type="number" min={1} max={10} value={customEditing.footprint.depth} aria-label={t('세로')} onChange={(event) => changeFootprint('depth', Number(event.target.value))} /></div>
    {AXES.map(([axis, label], index) => <label className="custom-axis" key={axis}><span>{axis} · {t(label)}</span><input type="range" min={25} max={100} step={5} value={Math.round(scale[index] * 100)} onChange={(event) => changeScale(index, Number(event.target.value) / 100)} /><output>{Math.round(scale[index] * 100)}%</output></label>)}
    <label className="custom-lock"><input type="checkbox" checked={locked} onChange={(event) => setLocked(event.target.checked)} />{t('비율 잠금')}</label>
    {!valid && <p>{t('놓을 수 없는 위치')}</p>}
    <footer><button type="button" onClick={reset}>{t('초기화')}</button><button type="button" onClick={cancelCustomObjectEdit}>{t('취소')}</button><button type="button" disabled={!valid || !customEditing.name.trim()} onClick={applyCustomObjectEdit}>{t('적용')}</button></footer>
  </section>
}
