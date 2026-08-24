import { Suspense, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import { publicBase } from '../services/publicBase'

// GLB 가구 실험: 파일 하나를 카탈로그 아이템으로. 씬은 배치 인스턴스마다 클론하고 그림자를 켠다.
// preload로 배치 시점엔 캐시에서 동기 마운트되게 해 FittedMesh 측정 타이밍을 지킨다.
const GLB_URLS: Record<string, string> = {
  'aero-bubble-chair': `${publicBase}models/aero-bubble-chair.glb`,
  'pink-slide': `${publicBase}models/pink-slide.glb`,
}
for (const url of Object.values(GLB_URLS)) useGLTF.preload(url)
// 각진 로우폴리 톤으로 통일할 타입 — 사진풍 스무스 셰이딩이 방 감성과 어긋나는 생성 모델용
const FLAT_TYPES = new Set(['pink-slide'])

function GlbScene({ url, preview, flat }: { url: string; preview: boolean; flat: boolean }) {
  const { scene } = useGLTF(url)
  const cloned = useMemo(() => {
    const copy = scene.clone(true)
    copy.traverse((node) => {
      const mesh = node as { isMesh?: boolean; castShadow?: boolean; receiveShadow?: boolean; material?: { transparent?: boolean; opacity?: number } }
      if (mesh.isMesh) {
        mesh.castShadow = true
        if (flat && mesh.material) (mesh.material as { flatShading?: boolean; needsUpdate?: boolean }).flatShading = true
        if (preview && mesh.material) { mesh.material = (mesh.material as { clone?: () => typeof mesh.material }).clone?.() ?? mesh.material; mesh.material!.transparent = true; mesh.material!.opacity = .55 }
      }
    })
    return copy
  }, [scene, preview, flat])
  return <primitive object={cloned} />
}

export default function GlbFurniture({ type, preview }: { type: string; preview: boolean }) {
  return <Suspense fallback={null}><GlbScene url={GLB_URLS[type]} preview={preview} flat={FLAT_TYPES.has(type)} /></Suspense>
}
