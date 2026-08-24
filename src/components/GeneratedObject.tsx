import { RoundedBox } from '@react-three/drei'
import { useMemo } from 'react'
import { CylinderGeometry, ExtrudeGeometry, Shape, SphereGeometry } from 'three'
import type { CustomObjectPart, CustomObjectSpec } from '../customObjectSpec'

// 유닛 쐐기(직각 삼각기둥): 바닥 평평, -X쪽이 수직 등, +X로 내려가는 경사면. 모든 파츠가 공유한다.
const wedgeGeometry = (() => {
  const profile = new Shape()
  profile.moveTo(-.5, -.5)
  profile.lineTo(.5, -.5)
  profile.lineTo(-.5, .5)
  profile.closePath()
  const geometry = new ExtrudeGeometry(profile, { depth: 1, bevelEnabled: false })
  geometry.translate(0, 0, -.5)
  return geometry
})()

// 오목 곡면 경사(쿼터파이프): -X쪽 수직 등에서 +X 바닥으로 부드럽게 흘러내리는 진짜 곡선 — 미끄럼틀용
const rampGeometry = (() => {
  const profile = new Shape()
  profile.moveTo(-.5, .5)
  profile.absarc(.5, .5, 1, Math.PI, Math.PI * 1.5, false)
  profile.lineTo(-.5, -.5)
  profile.closePath()
  const geometry = new ExtrudeGeometry(profile, { depth: 1, bevelEnabled: false, curveSegments: 12 })
  geometry.translate(0, 0, -.5)
  return geometry
})()

// 반원기둥: 평평한 바닥 + 둥근 등, 길이는 X축 — 아치·라운드탑·터널 지붕
const halfCylinderGeometry = (() => {
  const geometry = new CylinderGeometry(.5, .5, 1, 16, 1, false, 0, Math.PI)
  geometry.rotateZ(Math.PI / 2)
  geometry.scale(1, 2, 1)
  geometry.translate(0, -.5, 0)
  return geometry
})()

// 반구(돔): 평평한 면이 아래, 크기[1]이 전체 높이가 되도록 정규화
const hemisphereGeometry = (() => {
  const geometry = new SphereGeometry(.5, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2)
  geometry.scale(1, 2, 1)
  geometry.translate(0, -.5, 0)
  return geometry
})()

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
    {part.primitive === 'wedge' && <primitive object={wedgeGeometry} attach="geometry" />}
    {part.primitive === 'ramp' && <primitive object={rampGeometry} attach="geometry" />}
    {part.primitive === 'halfCylinder' && <primitive object={halfCylinderGeometry} attach="geometry" />}
    {part.primitive === 'hemisphere' && <primitive object={hemisphereGeometry} attach="geometry" />}
    {part.primitive === 'frustum' && <cylinderGeometry args={[.3, .5, 1, 16]} />}
    {part.primitive === 'elbow' && <torusGeometry args={[.35, .15, 10, 16, Math.PI / 2]} />}
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
