import { Suspense, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import { publicBase } from '../services/publicBase'

// GLB 가구 실험: 파일 하나를 카탈로그 아이템으로. 씬은 배치 인스턴스마다 클론하고 그림자를 켠다.
// preload로 배치 시점엔 캐시에서 동기 마운트되게 해 FittedMesh 측정 타이밍을 지킨다.
const GLB_URLS: Record<string, string> = {
  'pink-slide': `${publicBase}models/pink-slide.glb`,
  'color-drawers': `${publicBase}models/color-drawers.glb`,
  'cloud-sofa': `${publicBase}models/cloud-sofa.glb`,
}
export const GLB_TYPES = new Set(Object.keys(GLB_URLS))
for (const url of Object.values(GLB_URLS)) useGLTF.preload(url)
// 각진 로우폴리 톤으로 통일할 타입 — 사진풍 스무스 셰이딩이 방 감성과 어긋나는 생성 모델용
const FLAT_TYPES = new Set(['pink-slide', 'color-drawers'])

function GlbScene({ url, preview, flat }: { url: string; preview: boolean; flat: boolean }) {
  const { scene } = useGLTF(url)
  const cloned = useMemo(() => {
    const copy = scene.clone(true)
    copy.traverse((node) => {
      const mesh = node as { isMesh?: boolean; castShadow?: boolean; material?: { transparent?: boolean; opacity?: number; flatShading?: boolean; clone?: () => NonNullable<typeof mesh.material> } }
      if (mesh.isMesh) {
        mesh.castShadow = true
        // 재질은 인스턴스마다 반드시 클론: useGLTF 캐시의 공유 재질을 그대로 쓰면 탐색기 페이드/프리뷰가
        // 만진 opacity가 다른 화면의 같은 아이템에 그대로 새어 나간다 (방문자에게 반투명으로 보이던 버그)
        if (mesh.material?.clone) {
          mesh.material = mesh.material.clone()
          if (flat) mesh.material.flatShading = true
          if (preview) { mesh.material.transparent = true; mesh.material.opacity = .55 }
        }
      }
    })
    return copy
  }, [scene, preview, flat])
  return <primitive object={cloned} />
}

export default function GlbFurniture({ type, preview }: { type: string; preview: boolean }) {
  return <Suspense fallback={null}><GlbScene url={GLB_URLS[type]} preview={preview} flat={FLAT_TYPES.has(type)} /></Suspense>
}
