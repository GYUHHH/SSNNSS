import { RoundedBox } from '@react-three/drei'
import { useMemo } from 'react'
import type { CustomObjectPart, CustomObjectSpec } from '../customObjectSpec'

function Part({ part, preview }: { part: CustomObjectPart; preview: boolean }) {
  const material = <meshStandardMaterial color={part.color} roughness={part.roughness} metalness={part.metalness} transparent={preview} opacity={preview ? .55 : 1} />
  const props = { position: part.position, rotation: part.rotation, scale: part.size } as const
  if (part.primitive === 'roundedBox') return <RoundedBox {...props} args={[1, 1, 1]} radius={.12} smoothness={2}>{material}</RoundedBox>
  return <mesh {...props}>
    {part.primitive === 'box' && <boxGeometry args={[1, 1, 1]} />}
    {part.primitive === 'cylinder' && <cylinderGeometry args={[.5, .5, 1, 16]} />}
    {part.primitive === 'sphere' && <sphereGeometry args={[.5, 16, 12]} />}
    {part.primitive === 'capsule' && <capsuleGeometry args={[.35, .3, 4, 12]} />}
    {part.primitive === 'torus' && <torusGeometry args={[.35, .15, 10, 20]} />}
    {part.primitive === 'cone' && <coneGeometry args={[.5, 1, 16]} />}
    {material}
  </mesh>
}

export default function GeneratedObject({ spec, preview = false }: { spec: CustomObjectSpec; preview?: boolean }) {
  const offset = useMemo(() => {
    const min = [Infinity, Infinity, Infinity]; const max = [-Infinity, -Infinity, -Infinity]
    for (const part of spec.parts) for (let axis = 0; axis < 3; axis++) {
      const half = part.size[axis] / 2
      min[axis] = Math.min(min[axis], part.position[axis] - half)
      max[axis] = Math.max(max[axis], part.position[axis] + half)
    }
    return spec.category === 'wallDecoration'
      ? [-(min[0] + max[0]) / 2, -(min[1] + max[1]) / 2, -max[2]] as [number, number, number]
      : [-(min[0] + max[0]) / 2, -min[1], -(min[2] + max[2]) / 2] as [number, number, number]
  }, [spec])
  return <group position={offset}>{spec.parts.map((part) => <Part key={part.id} part={part} preview={preview} />)}</group>
}
