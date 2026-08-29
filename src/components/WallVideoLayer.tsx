import { Html } from '@react-three/drei'
import { findFit } from './Furniture'
import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Matrix4, Vector3, type Group } from 'three'
import { loadAudioPrefs, resolutionFor, useRoomStore } from '../store'
import { fitMeshToFootprint, resolveSurface, withResolution } from '../services/roomGrid'
import { fitFrameScreen, useFrameVideoId, useVideoDisplayMeta } from '../services/mediaStore'
import { VIDEO_FRAME_SIZES } from './InventoryFurniture'
import { embedSrc, trackIframe, watchPlaylistOrder, playFrame, framePlayerStates } from '../services/ytResume'
import { clipIsPlaying, loadClipUrls, playClip } from '../services/mediaStore'
import { t } from '../services/i18n'
import { WALL_HTML_Z_INDEX_RANGE, WALL_VIDEO_ORDER } from '../services/renderOrder'
import { didRenderRoomFrame } from '../services/renderSync'

const VIDEO_MASK_VERTEX = 'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}'
const VIDEO_MASK_FRAGMENT = 'void main(){gl_FragColor=vec4(0.0);}'

// CSS's 2D matrix can only draw a parallelogram. A first-person perspective camera projects the screen to a
// general quadrilateral, so map all four corners there; the orthographic room view keeps its cheaper affine path.
const perspectiveTransform = (width: number, height: number, [tl, tr, br, bl]: readonly (readonly [number, number])[]) => {
  const dx1 = tr[0] - br[0], dx2 = bl[0] - br[0], dx3 = tl[0] - tr[0] + br[0] - bl[0]
  const dy1 = tr[1] - br[1], dy2 = bl[1] - br[1], dy3 = tl[1] - tr[1] + br[1] - bl[1]
  const denominator = dx1 * dy2 - dx2 * dy1
  if (Math.abs(denominator) < 1e-6) return null
  const g = (dx3 * dy2 - dx2 * dy3) / denominator
  const h = (dx1 * dy3 - dx3 * dy1) / denominator
  const a = tr[0] - tl[0] + g * tr[0], b = bl[0] - tl[0] + h * bl[0]
  const d = tr[1] - tl[1] + g * tr[1], e = bl[1] - tl[1] + h * bl[1]
  return `matrix3d(${a / width},${d / width},0,${g / width},${b / height},${e / height},0,${h / height},0,0,1,0,${tl[0]},${tl[1]},0,1)`
}
if (import.meta.env.DEV) console.assert(perspectiveTransform(2, 1, [[0, 0], [2, 0], [2, 1], [0, 1]]) === 'matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)', 'perspective screen transform must preserve a flat rectangle')

// The playing iframes live here, OUTSIDE the furniture tree: entering edit mode swaps every piece into a
// different wrapper, which would unmount an iframe rendered inside it and reload the video. This layer stays
// mounted through mode changes and simply copies each frame's live world matrix per frame, so playback survives
// editing and even follows the frame while it is being dragged. Every playing frame gets its own player, so
// several frames can run at once, each with its own mute toggle.
export default function WallVideoLayer() {
  const { playingFrames, setFrameMuted, videoLinks, activeRoomId, currentHandle, furniture, videoFrames } = useRoomStore()
  const clipIds = new Set([...Object.keys(videoFrames), ...Object.keys(loadClipUrls())])
  const directFrames = furniture.filter((item) => !item.removed && item.type.startsWith('video-frame') && !videoLinks[item.id] && clipIds.has(item.id)).map((item) => item.id)
  // one order-keeper per playing playlist frame, alive across wall<->panel switches (it follows whichever
  // iframe is currently registered for the frame), enforcing the site's custom order and syncing the id list
  useEffect(() => {
    const stops = playingFrames
      .map((id) => ({ id, link: videoLinks[id] }))
      .filter((entry) => entry.link?.startsWith('pl:'))
      .map((entry) => watchPlaylistOrder(entry.id, entry.link.slice(3).split('@')[0]))
    return () => stops.forEach((stop) => stop())
  }, [playingFrames, videoLinks])
  // A page gesture may unlock sound, but it never decides which videos should make sound. Only frames the
  // visitor explicitly enabled before are retried, and that retry does not rewrite the saved preference.
  const latest = useRef({ playingFrames, directFrames, setFrameMuted, activeRoomId })
  latest.current = { playingFrames, directFrames, setFrameMuted, activeRoomId }
  useEffect(() => {
    let used = false
    const restoreSound = () => {
      const prefs = loadAudioPrefs(latest.current.activeRoomId)
      for (const id of [...latest.current.playingFrames, ...latest.current.directFrames]) {
        if (prefs[id] === true) latest.current.setFrameMuted(id, false, false)
      }
    }
    // Returning to a room retries its saved sound choice as soon as the new room iframe is mounted. If autoplay
    // policy blocks it, the next real gesture retries the same choice without changing the preference.
    restoreSound()
    const onFirstGesture = () => { if (!used) { used = true; restoreSound() } }
    window.addEventListener('pointerdown', onFirstGesture, { capture: true })
    return () => window.removeEventListener('pointerdown', onFirstGesture, true)
  }, [activeRoomId, currentHandle])
  // Focus guard: if a wall iframe holds focus when the tab is left, the browser re-focuses it on return and
  // the YouTube player mistakes that for user activity, waking its control overlay. Whenever focus lands on a
  // wall iframe (window 'blur' fires the moment it does, and also on real tab-leave) it is released right away,
  // so a tab return has no focus to restore and the overlay stays asleep. The wall iframe itself is also
  // pointer-transparent; only our explicit controls accept input, so returning with the cursor over it cannot
  // synthesize hover activity inside YouTube. The expanded panel player remains fully interactive.
  useEffect(() => {
    const releaseWallIframeFocus = () => setTimeout(() => {
      const active = document.activeElement
      if (active instanceof HTMLIFrameElement && active.closest('.wall-video')) active.blur()
    }, 0)
    window.addEventListener('blur', releaseWallIframeFocus)
    window.addEventListener('focus', releaseWallIframeFocus)
    return () => { window.removeEventListener('blur', releaseWallIframeFocus); window.removeEventListener('focus', releaseWallIframeFocus) }
  }, [])
  // Mobile browsers pause media while the screen is off and the embeds do not resume by themselves.
  // The state right before hiding is snapshotted, and on return ONLY frames that were actually playing get
  // nudged back — a video the user paused stays paused, and no commands go to players that need none.
  const playingBeforeHide = useRef({ frames: [] as string[], clips: [] as string[] })
  useEffect(() => {
    // mobile only: desktop browsers keep background tabs playing, so PC gets no intervention at all
    if (!window.matchMedia('(pointer: coarse)').matches) return
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        playingBeforeHide.current = {
          frames: latest.current.playingFrames.filter((id) => framePlayerStates[id] === 1 || framePlayerStates[id] === 3),
          clips: latest.current.directFrames.filter(clipIsPlaying),
        }
        return
      }
      const nudge = () => {
        playingBeforeHide.current.frames.forEach((id) => { if (framePlayerStates[id] !== 1) playFrame(id) })
        playingBeforeHide.current.clips.forEach(playClip)
      }
      nudge()
      setTimeout(nudge, 1200)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])
  return <>{playingFrames.map((id) => <WallVideo key={id} frameId={id} />)}</>
}

function WallVideo({ frameId }: { frameId: string }) {
  const { videoLinks, furniture, mode } = useRoomStore()
  const item = furniture.find((entry) => entry.id === frameId)
  const videoId = videoLinks[frameId]
  // The wall player is the only iframe for this frame and stays mounted while its side panel is open.
  const active = !!item && !item.removed && !!videoId
  const dims = VIDEO_FRAME_SIZES[(item?.type ?? '')] ?? VIDEO_FRAME_SIZES['video-frame-3']
  const turned = !!item && Math.abs(Math.round(item.rotation[1] / (Math.PI / 2))) % 2 === 1
  const aspectLookup = useFrameVideoId(frameId, videoId)
  const display = useVideoDisplayMeta(active ? aspectLookup : undefined)
  const [displayReady, setDisplayReady] = useState(false)
  useLayoutEffect(() => {
    setDisplayReady(false)
    if (aspectLookup && display === undefined) return
    const frame = requestAnimationFrame(() => setDisplayReady(true))
    return () => cancelAnimationFrame(frame)
  }, [aspectLookup, display])
  const surface = item && resolveSurface(furniture, item.surfaceId)
  const [targetWidth, targetHeight] = surface ? fitMeshToFootprint(withResolution(surface, resolutionFor(item)), item.footprint) : dims
  const [screenWidth, screenHeight] = fitFrameScreen(dims[0], dims[1], targetWidth, targetHeight, display?.aspect ?? null, turned)
  const fallbackAspect = turned ? targetHeight / targetWidth : targetWidth / targetHeight
  // The matrix projects the div onto the fitted 3D screen. Its own ratio must be the actual content ratio;
  // using screenWidth/screenHeight here stretched a 16:9 YouTube player whenever a frame was resized.
  const divHeight = Math.round(640 / (display?.aspect ?? fallbackAspect))
  const crop = display?.playerCrop ?? { left: 0, top: 0, right: 1, bottom: 1 }
  const cropWidth = Math.max(.01, crop.right - crop.left)
  const cropHeight = Math.max(.01, crop.bottom - crop.top)
  const screen = useRef<Group>(null)
  const element = useRef<HTMLDivElement>(null)
  const fitSynced = useRef(false)
  const corners = useRef([new Vector3(), new Vector3(), new Vector3(), new Vector3()])
  const previousTransform = useRef('')
  useFrame(({ camera, gl }) => {
    // RenderGovernor intentionally skips WebGL frames while idle. Moving this DOM iframe on a skipped frame
    // made it run ahead of the still-visible 3D frame, which looked like the video was rubber-banding after it.
    // Apply the matching projection only after the Canvas has actually drawn that exact camera frame.
    if (!didRenderRoomFrame()) return
    if (!screen.current || !element.current) { fitSynced.current = false; return }
    if (!fitSynced.current) { element.current.style.visibility = 'hidden'; return }
    screen.current.updateWorldMatrix(true, false)
    const [topLeft, topRight, bottomRight, bottomLeft] = corners.current
    topLeft.set(-screenWidth / 2, screenHeight / 2, 0).applyMatrix4(screen.current.matrixWorld).project(camera)
    topRight.set(screenWidth / 2, screenHeight / 2, 0).applyMatrix4(screen.current.matrixWorld).project(camera)
    bottomRight.set(screenWidth / 2, -screenHeight / 2, 0).applyMatrix4(screen.current.matrixWorld).project(camera)
    bottomLeft.set(-screenWidth / 2, -screenHeight / 2, 0).applyMatrix4(screen.current.matrixWorld).project(camera)
    // Use the canvas's live size from the first frame. R3F's cached size can briefly describe the pre-layout
    // viewport on initial entry; a later room change caused a resize and only then made the video follow correctly.
    const rect = gl.domElement.getBoundingClientRect()
    const point = (value: Vector3) => [(value.x + 1) * rect.width / 2, (1 - value.y) * rect.height / 2] as const
    const [tl, tr, br, bl] = [point(topLeft), point(topRight), point(bottomRight), point(bottomLeft)]
    const transform = camera.type === 'PerspectiveCamera'
      ? perspectiveTransform(640, divHeight, [tl, tr, br, bl])
      : `matrix(${(tr[0] - tl[0]) / 640},${(tr[1] - tl[1]) / 640},${(bl[0] - tl[0]) / divHeight},${(bl[1] - tl[1]) / divHeight},${tl[0]},${tl[1]})`
    if (!transform) { element.current.style.visibility = 'hidden'; return }
    if (transform !== previousTransform.current) { previousTransform.current = transform; element.current.style.transform = transform }
    element.current.style.visibility = !displayReady || corners.current.some((corner) => corner.z < -1 || corner.z > 1) ? 'hidden' : 'visible'
  }, 2) // after RenderGovernor: the DOM video and its WebGL frame reach the browser in the same painted frame
  // A DOM iframe has no 3D depth: without routing its shield back through R3F, it steals clicks from chairs and
  // props visibly standing in front of the screen. Forward the ordinary pointer sequence to the room event host;
  // the scene raycaster then chooses the actually front-most object. YouTube's uncovered skip-ad corner remains
  // a real iframe target.
  const forwardToRoom = (event: { nativeEvent: MouseEvent | PointerEvent; stopPropagation: () => void }) => {
    event.stopPropagation()
    const host = document.querySelector('.canvas-host')
    if (!(host instanceof HTMLElement)) return
    const source = event.nativeEvent
    const init = { bubbles: true, cancelable: true, clientX: source.clientX, clientY: source.clientY, button: source.button, buttons: source.buttons }
    host.dispatchEvent(source instanceof PointerEvent
      ? new PointerEvent(source.type, { ...init, pointerId: source.pointerId, pointerType: source.pointerType, isPrimary: source.isPrimary, pressure: source.pressure })
      : new MouseEvent(source.type, init))
  }
  // Track changes may briefly wait for new aspect metadata, but the iframe must stay mounted: recreating it
  // starts muted again and drops the sound choice that was already active for this frame.
  if (!active) return null
  return <FollowFit fitName={`fit:${item.id}`} synced={fitSynced}>
    <group rotation={[0, 0, -item.rotation[1]]}>
      <group ref={screen} position={[0, 0, .001]}>
        {/* The transparent WebGL plane punches the screen through the wall. Later room objects draw over it, so
            wall media stays behind furniture, photos, speech bubbles and every future 3D object. */}
        <mesh renderOrder={WALL_VIDEO_ORDER}><planeGeometry args={[screenWidth, screenHeight]} /><shaderMaterial side={2} depthWrite={false} vertexShader={VIDEO_MASK_VERTEX} fragmentShader={VIDEO_MASK_FRAGMENT} /></mesh>
        {/* No CSS matrix3d: iPhone Chrome and Safari share WebKit's iframe compositor and both drift there. The
            child receives one affine matrix calculated from these exact three projected screen corners. */}
        <Html calculatePosition={() => [0, 0]} wrapperClass="wall-video-portal" zIndexRange={WALL_HTML_Z_INDEX_RANGE} style={{ pointerEvents: 'none' }}>
        <div ref={element} className="wall-video" data-frame-id={frameId} data-video-id={aspectLookup} style={{ width: 640, height: divHeight, pointerEvents: mode === 'edit' ? 'none' : 'auto' }}>
          {/* controls=0 keeps YouTube's control bar from popping over the wall screen (it auto-shows on tab
              return); the expanded panel player keeps its controls */}
          <ResumingIframe key={frameId} videoId={videoId} frameId={frameId} extra="autoplay=1&playsinline=1&mute=1&controls=0" frameStyle={{ width: 640 / cropWidth, height: divHeight / cropHeight, left: -640 * crop.left / cropWidth, top: -divHeight * crop.top / cropHeight, pointerEvents: mode === 'edit' ? 'none' : 'auto' }} />
          {/* the two shields carry the open-the-panel click and together cover everything but YouTube's own
              skip-ad corner, which is left live so the visitor can press it themselves */}
          {mode !== 'edit' && ['top', 'rest'].map((part) => <div key={part} className={`wall-video-shield ${part}`}
            onPointerDown={forwardToRoom} onPointerMove={forwardToRoom} onPointerUp={forwardToRoom}
            onPointerCancel={forwardToRoom} onClick={forwardToRoom} />)}
        </div></Html>
      </group>
    </group>
  </FollowFit>
}

function FollowFit({ fitName, synced, children }: { fitName: string; synced: React.MutableRefObject<boolean>; children: React.ReactNode }) {
  const holder = useRef<Group>(null)
  const parentInverse = useRef(new Matrix4())
  useFrame(({ scene }) => {
    const target = holder.current
    if (!target) { synced.current = false; return }
    const fit = findFit(target, scene, fitName.replace('fit:', ''))
    if (!fit) { synced.current = false; return }
    fit.updateWorldMatrix(true, false)
    target.parent?.updateWorldMatrix(true, false)
    target.matrix.copy(fit.matrixWorld)
    if (target.parent) target.matrix.premultiply(parentInverse.current.copy(target.parent.matrixWorld).invert())
    target.matrixAutoUpdate = false
    target.matrixWorldNeedsUpdate = true
    synced.current = true
  })
  return <group ref={holder}>{children}</group>
}

// src is fixed at mount (recomputing it would reload the embed); the tracker keeps the resume point fresh
export function ResumingIframe({ videoId, frameId, extra, frameStyle }: { videoId: string; frameId: string; extra: string; frameStyle?: React.CSSProperties }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [src] = useState(() => embedSrc(videoId, frameId, extra))
  useEffect(() => { if (frame.current) return trackIframe(frame.current, frameId) }, [frameId])
  return <iframe ref={frame} title={t('유튜브 재생')} src={src} style={frameStyle} referrerPolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowFullScreen />
}
