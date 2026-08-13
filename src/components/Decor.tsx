import { RoundedBox } from '@react-three/drei'
import Furniture from './Furniture'
import { useRoomStore } from '../store'
import { palette } from '../services/palette'
import { colorOf } from '../services/styles'

export default function Decor() {
  const { litLamps, furniture } = useRoomStore()
  const styleOf = (id: string) => furniture.find((item) => item.id === id)?.styleId
  const rugColor = colorOf(styleOf('rug'), palette.clay)
  const lampColor = colorOf(styleOf('lamp'), palette.linen)
  const cabinetColor = colorOf(styleOf('cabinet'), palette.woodMid)
  return <>
    <Furniture id="rug">
      <RoundedBox receiveShadow castShadow args={[2.1, 0.06, 1.4]} radius={0.025} smoothness={2} position={[0, 0.03, 0]}><meshStandardMaterial color={rugColor} roughness={0.95} /></RoundedBox>
      <RoundedBox receiveShadow args={[1.74, 0.012, 1.04]} radius={0.02} smoothness={2} position={[0, 0.063, 0]}><meshStandardMaterial color={palette.linen} roughness={0.95} /></RoundedBox>
      <RoundedBox receiveShadow args={[1.34, 0.014, 0.64]} radius={0.02} smoothness={2} position={[0, 0.065, 0]}><meshStandardMaterial color={palette.rust} roughness={0.95} /></RoundedBox>
    </Furniture>
    <Furniture id="plant">
      <mesh castShadow position={[0, 0.32, 0]}><cylinderGeometry args={[0.34, 0.26, 0.62, 10]} /><meshStandardMaterial color={palette.rust} roughness={0.8} /></mesh>
      {[[-0.28, 0.9, 0], [0.25, 1.05, 0.08], [0, 1.18, -0.22]].map(([x, y, z], index) => <mesh castShadow key={index} position={[x, y, z]} rotation={[0.5, index, 0]}><sphereGeometry args={[0.32, 8, 8]} /><meshStandardMaterial color={palette.sage} roughness={0.85} /></mesh>)}
    </Furniture>
    <Furniture id="lamp">
      <mesh castShadow position={[0, 0.225, 0]}><cylinderGeometry args={[0.14, 0.18, 0.45, 10]} /><meshStandardMaterial color={palette.woodDark} roughness={0.7} /></mesh>
      <mesh castShadow position={[0, 0.76, 0]}><cylinderGeometry args={[0.35, 0.2, 0.5, 12, 1, true]} /><meshStandardMaterial color={lampColor} side={2} roughness={0.85} /></mesh>
      {litLamps.has('lamp') && <pointLight color="#ffc66d" intensity={8} distance={3} position={[0, 0.75, 0]} />}
    </Furniture>
    <Furniture id="cabinet">
      <RoundedBox castShadow args={[1.4, 1.1, 0.7]} radius={0.04} smoothness={2} position={[0, 0.55, 0]}><meshStandardMaterial color={cabinetColor} roughness={0.7} /></RoundedBox>
      <RoundedBox castShadow args={[1.14, 0.28, 0.03]} radius={0.02} smoothness={2} position={[0, 0.72, 0.37]}><meshStandardMaterial color={palette.woodLight} roughness={0.65} /></RoundedBox>
      <RoundedBox castShadow args={[1.14, 0.28, 0.03]} radius={0.02} smoothness={2} position={[0, 0.33, 0.37]}><meshStandardMaterial color={palette.woodLight} roughness={0.65} /></RoundedBox>
      <mesh castShadow position={[0, 0.72, 0.39]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.02, 0.02, 0.12, 8]} /><meshStandardMaterial color={palette.charcoal} roughness={0.6} /></mesh>
      <mesh castShadow position={[0, 0.33, 0.39]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.02, 0.02, 0.12, 8]} /><meshStandardMaterial color={palette.charcoal} roughness={0.6} /></mesh>
    </Furniture>
    <Furniture id="bin"><mesh castShadow position={[0, 0.23, 0]}><cylinderGeometry args={[0.22, 0.3, 0.46, 10]} /><meshStandardMaterial color={palette.metal} roughness={0.6} /></mesh></Furniture>
  </>
}
