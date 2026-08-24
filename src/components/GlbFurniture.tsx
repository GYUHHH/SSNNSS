import { Suspense, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import { publicBase } from '../services/publicBase'

// GLB 가구 실험: 파일 하나를 카탈로그 아이템으로. 씬은 배치 인스턴스마다 클론하고 그림자를 켠다.
// preload로 배치 시점엔 캐시에서 동기 마운트되게 해 FittedMesh 측정 타이밍을 지킨다.
const AERO_BUBBLE_URL = `${publicBase}models/aero-bubble-chair.glb`
useGLTF.preload(AERO_BUBBLE_URL)

function GlbScene({ url, preview }: { url: string; preview: boolean }) {
  const { scene } = useGLTF(url)
  const cloned = useMemo(() => {
    const copy = scene.clone(true)
    copy.traverse((node) => {
      const mesh = node as { isMesh?: boolean; castShadow?: boolean; receiveShadow?: boolean; material?: { transparent?: boolean; opacity?: number } }
      if (mesh.isMesh) {
        mesh.castShadow = true
        if (preview && mesh.material) { mesh.material = (mesh.material as { clone?: () => typeof mesh.material }).clone?.() ?? mesh.material; mesh.material!.transparent = true; mesh.material!.opacity = .55 }
      }
    })
    return copy
  }, [scene, preview])
  return <primitive object={cloned} />
}

export default function GlbFurniture({ preview }: { preview: boolean }) {
  return <Suspense fallback={null}><GlbScene url={AERO_BUBBLE_URL} preview={preview} /></Suspense>
}
