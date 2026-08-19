import { colorPresets, floorStyleOf, floorStyles, wallStylePresets } from '../services/styles'
import { useRoomStore } from '../store'

export default function StylePanel() {
  const { styleTarget, furniture, wallStyle, floorStyle, setWallStyle, setFloorStyle, setFurnitureStyle } = useRoomStore()
  if (!styleTarget) return null

  if (styleTarget.kind === 'floor') {
    const current = floorStyleOf(floorStyle).id
    return <section className="style-panel" aria-label="바닥 꾸미기"><header><strong>바닥 스타일</strong></header>
      <div className="style-swatches">{floorStyles.map((style) => <button key={style.id} type="button" title={style.label} className={current === style.id ? 'active' : ''} style={{ background: style.color }} onClick={() => setFloorStyle(style.id)} />)}</div>
    </section>
  }

  const isWall = styleTarget.kind === 'wall'
  const title = isWall ? (styleTarget.wallId === 'leftWall' ? '왼쪽 벽' : '오른쪽 벽') : furniture.find((item) => item.id === styleTarget.id)?.name ?? '가구'
  const presets = isWall ? colorPresets.filter((preset) => (wallStylePresets as readonly string[]).includes(preset.id)) : colorPresets
  const current = isWall ? wallStyle[styleTarget.wallId] : furniture.find((item) => item.id === styleTarget.id)?.styleId
  const apply = (presetId: string) => isWall ? setWallStyle(styleTarget.wallId, presetId) : setFurnitureStyle(styleTarget.id, presetId)
  return <section className="style-panel" aria-label={`${title} 꾸미기`}><header><strong>{title} 색상</strong></header>
    <div className="style-swatches">{presets.map((preset) => <button key={preset.id} type="button" title={preset.label} className={current === preset.id ? 'active' : ''} style={{ background: preset.color }} onClick={() => apply(preset.id)} />)}</div>
  </section>
}
