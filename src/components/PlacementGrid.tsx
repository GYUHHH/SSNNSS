import { useMemo } from 'react'
import { BufferGeometry, Float32BufferAttribute } from 'three'
import { getCellSize, type PlacementSurface } from '../services/roomGrid'

export type GridArea = { x0: number; y0: number; x1: number; y1: number }

export default function PlacementGrid({ surface, area }: { surface: PlacementSurface; area?: GridArea }) {
  const geometry = useMemo(() => {
    const cell = getCellSize(surface); const lines: number[] = []
    const x0 = Math.max(0, area?.x0 ?? 0), x1 = Math.min(surface.gridColumns, area?.x1 ?? surface.gridColumns)
    const y0 = Math.max(0, area?.y0 ?? 0), y1 = Math.min(surface.gridRows, area?.y1 ?? surface.gridRows)
    const left = -surface.width / 2, top = -surface.height / 2
    for (let index = x0; index <= x1; index += 1) {
      const x = left + index * cell.width
      lines.push(x, top + y0 * cell.height, 0, x, top + y1 * cell.height, 0)
    }
    for (let index = y0; index <= y1; index += 1) {
      const y = top + index * cell.height
      lines.push(left + x0 * cell.width, y, 0, left + x1 * cell.width, y, 0)
    }
    return new BufferGeometry().setAttribute('position', new Float32BufferAttribute(lines, 3))
  }, [surface, area?.x0, area?.x1, area?.y0, area?.y1])
  const offset = surface.orientation === 'horizontal' ? .01 : .008
  return <lineSegments geometry={geometry} position={[surface.position[0] + surface.normal[0] * offset, surface.position[1] + surface.normal[1] * offset, surface.position[2] + surface.normal[2] * offset]} rotation={surface.rotation}><lineBasicMaterial color="#d8b576" transparent opacity={.78} /></lineSegments>
}
