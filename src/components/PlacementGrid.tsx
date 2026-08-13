import { useMemo } from 'react'
import { BufferGeometry, Float32BufferAttribute } from 'three'
import { getCellSize, type PlacementSurface } from '../services/roomGrid'

export default function PlacementGrid({ surface }: { surface: PlacementSurface }) {
  const geometry = useMemo(() => {
    const cell = getCellSize(surface); const lines: number[] = []
    for (let index = 0; index <= surface.gridColumns; index += 1) {
      const x = -surface.width / 2 + index * cell.width
      lines.push(x, -surface.height / 2, 0, x, surface.height / 2, 0)
    }
    for (let index = 0; index <= surface.gridRows; index += 1) {
      const y = -surface.height / 2 + index * cell.height
      lines.push(-surface.width / 2, y, 0, surface.width / 2, y, 0)
    }
    return new BufferGeometry().setAttribute('position', new Float32BufferAttribute(lines, 3))
  }, [surface])
  const offset = surface.orientation === 'horizontal' ? .01 : .008
  return <lineSegments geometry={geometry} position={[surface.position[0] + surface.normal[0] * offset, surface.position[1] + surface.normal[1] * offset, surface.position[2] + surface.normal[2] * offset]} rotation={surface.rotation}><lineBasicMaterial color="#d8b576" transparent opacity={.78} /></lineSegments>
}
