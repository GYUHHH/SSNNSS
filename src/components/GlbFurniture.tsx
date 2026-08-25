import { Suspense, useEffect, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import { Box3, Vector3 } from 'three'
import { publicBase } from '../services/publicBase'

// GLB 가구 실험: 파일 하나를 카탈로그 아이템으로. 씬은 배치 인스턴스마다 클론하고 그림자를 켠다.
// preload로 배치 시점엔 캐시에서 동기 마운트되게 해 FittedMesh 측정 타이밍을 지킨다.
const GLB_URLS: Record<string, string> = {
  'pink-slide': `${publicBase}models/pink-slide.glb`,
  'color-drawers': `${publicBase}models/color-drawers.glb`,
  'cloud-sofa': `${publicBase}models/cloud-sofa.glb`,
  'dome-sofa': `${publicBase}models/dome-sofa.glb`,
  'deco-shelf': `${publicBase}models/deco-shelf.glb`,
  'frutiger-desk': `${publicBase}models/frutiger-desk.glb`,
  'aqua-table': `${publicBase}models/aqua-table.glb`,
  'hanging-bubble-chair': `${publicBase}models/hanging-bubble-chair.glb`,
}
export const GLB_TYPES = new Set(Object.keys(GLB_URLS))
for (const url of Object.values(GLB_URLS)) useGLTF.preload(url)
// 각진 로우폴리 톤으로 통일할 타입 — 사진풍 스무스 셰이딩이 방 감성과 어긋나는 생성 모델용
const FLAT_TYPES = new Set(['pink-slide', 'color-drawers'])

// GLB는 비동기 로드라 FittedMesh가 로드 전 빈 치수를 잴 수 있다 — 로드 완료를 알려 재측정시킨다
const readyListeners = new Set<() => void>()
export const onGlbReady = (listener: () => void) => { readyListeners.add(listener); return () => { readyListeners.delete(listener) } }

function GlbScene({ url, preview, flat, custom, wall }: { url: string; preview: boolean; flat: boolean; custom?: boolean; wall?: boolean }) {
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
          // 유저 생성 GLB는 후처리 없이 그대로 오므로 카탈로그와 같은 무광 정책을 런타임에 적용
          if (custom) { const material = mesh.material as { metalness?: number; roughness?: number }; material.metalness = 0; material.roughness = .95 }
          if (preview) { mesh.material.transparent = true; mesh.material.opacity = .55 }
        }
      }
    })
    // 생성 모델은 원점이 중앙이라 절반이 바닥에 잠긴다 — 바닥 중앙 기준으로 정렬
    if (custom) {
      const bounds = new Box3().setFromObject(copy)
      const center = bounds.getCenter(new Vector3())
      // 벽 장식은 중앙 정렬 + 등면을 벽에(z=0), 바닥 가구는 밑면을 바닥에
      if (wall) copy.position.set(-center.x, -center.y, -bounds.max.z)
      else copy.position.set(-center.x, -bounds.min.y, -center.z)
    }
    return copy
  }, [scene, preview, flat, custom, wall])
  useEffect(() => { for (const listener of [...readyListeners]) listener() }, [scene])
  return <primitive object={cloned} />
}

export default function GlbFurniture({ type, url, wall, preview }: { type?: string; url?: string; wall?: boolean; preview: boolean }) {
  const resolved = url ?? GLB_URLS[type ?? '']
  if (!resolved) return null
  return <Suspense fallback={null}><GlbScene url={resolved} preview={preview} flat={!!type && FLAT_TYPES.has(type)} custom={!!url} wall={wall} /></Suspense>
}
