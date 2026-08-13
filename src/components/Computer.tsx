import Furniture from './Furniture'
import { useRoomStore } from '../store'

export default function Computer() {
  const { computerOn } = useRoomStore()
  return <Furniture id="computer">
    <mesh castShadow position={[0, 0.6, -0.08]}><boxGeometry args={[1.06, 0.64, 0.1]} /><meshStandardMaterial color="#4b4c50" /></mesh>
    <mesh position={[0, 0.6, -0.029]}><planeGeometry args={[0.96, 0.54]} /><meshStandardMaterial color={computerOn ? '#6fa7a4' : '#26343a'} emissive={computerOn ? '#305c59' : '#000000'} emissiveIntensity={computerOn ? 0.8 : 0} /></mesh>
    <mesh castShadow position={[0, 0.15, -0.08]}><boxGeometry args={[0.12, 0.32, 0.12]} /><meshStandardMaterial color="#49454a" /></mesh>
    <mesh castShadow position={[0, 0.02, -0.02]}><boxGeometry args={[0.56, 0.07, 0.3]} /><meshStandardMaterial color="#49454a" /></mesh>
    <mesh castShadow position={[-0.05, 0.025, 0.43]}><boxGeometry args={[0.66, 0.05, 0.25]} /><meshStandardMaterial color="#e9deca" /></mesh>
  </Furniture>
}
