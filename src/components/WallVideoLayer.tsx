import { Html } from '@react-three/drei'
import { findFit } from './Furniture'
import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Matrix4, Vector3, type Group } from 'three'
import { loadAudioPrefs, useRoomStore } from '../store'
import { fitToVideo, useFrameVideoId, useVideoDisplayMeta } from '../services/mediaStore'
import { VIDEO_FRAME_SIZES } from './InventoryFurniture'
import { isVisiting } from '../services/social'
import { openReactionPicker } from './ReactionPicker'
import { embedSrc, trackIframe, watchPlaylistOrder, playFrame, framePlayerStates } from '../services/ytResume'
import { clipIsPlaying, loadClipUrls, playClip } from '../services/mediaStore'
import { WALL_HTML_Z_INDEX_RANGE, WALL_VIDEO_ORDER } from '../services/renderOrder'

const VIDEO_MASK_VERTEX = 'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}'
const VIDEO_MASK_FRAGMENT = 'void main(){gl_FragColor=vec4(0.0);}'

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
  const { videoLinks, furniture, openVideoPanel, mode, openObject, enterEditFurniture } = useRoomStore()
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
  const [screenWidth, screenHeight] = fitToVideo(turned ? dims[1] : dims[0], turned ? dims[0] : dims[1], display?.aspect ?? null)
  const divHeight = Math.round(640 * (screenHeight / screenWidth))
  const crop = display?.playerCrop ?? { left: 0, top: 0, right: 1, bottom: 1 }
  const cropWidth = Math.max(.01, crop.right - crop.left)
  const cropHeight = Math.max(.01, crop.bottom - crop.top)
  const screen = useRef<Group>(null)
  const element = useRef<HTMLDivElement>(null)
  const corners = useRef([new Vector3(), new Vector3(), new Vector3()])
  const previousTransform = useRef('')
  useFrame(({ camera, size }) => {
    if (!screen.current || !element.current) return
    screen.current.updateWorldMatrix(true, false)
    const [topLeft, topRight, bottomLeft] = corners.current
    topLeft.set(-screenWidth / 2, screenHeight / 2, 0).applyMatrix4(screen.current.matrixWorld).project(camera)
    topRight.set(screenWidth / 2, screenHeight / 2, 0).applyMatrix4(screen.current.matrixWorld).project(camera)
    bottomLeft.set(-screenWidth / 2, -screenHeight / 2, 0).applyMatrix4(screen.current.matrixWorld).project(camera)
    const point = (value: Vector3) => [(value.x + 1) * size.width / 2, (1 - value.y) * size.height / 2] as const
    const [tl, tr, bl] = [point(topLeft), point(topRight), point(bottomLeft)]
    const transform = `matrix(${(tr[0] - tl[0]) / 640},${(tr[1] - tl[1]) / 640},${(bl[0] - tl[0]) / divHeight},${(bl[1] - tl[1]) / divHeight},${tl[0]},${tl[1]})`
    if (transform !== previousTransform.current) { previousTransform.current = transform; element.current.style.transform = transform }
    element.current.style.visibility = !displayReady || topLeft.z < -1 || topLeft.z > 1 ? 'hidden' : 'visible'
  })
  // the shields cover the screen, so without this a hold would only register on the frame's edge
  const holdTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const held = useRef(false)
  const cancelHold = () => { clearTimeout(holdTimer.current); holdTimer.current = undefined }
  const startHold = (event: React.PointerEvent) => {
    held.current = false
    const { clientX, clientY } = event
    // the same hold every other piece answers to: a visitor gets the reaction picker, the owner goes into edit.
    // The owner's branch was simply missing, which made the screen the one part of a video frame that refused
    // the hold-to-edit gesture in their own room.
    holdTimer.current = setTimeout(() => { held.current = true; if (isVisiting()) openReactionPicker({ id: frameId, x: clientX, y: clientY }); else enterEditFurniture(frameId) }, 500)
  }
  // Track changes may briefly wait for new aspect metadata, but the iframe must stay mounted: recreating it
  // starts muted again and drops the sound choice that was already active for this frame.
  if (!active) return null
  return <FollowFit fitName={`fit:${item.id}`}>
    <group rotation={[0, 0, -item.rotation[1]]}>
      <group ref={screen} position={[0, 0, .042]}>
        {/* The transparent WebGL plane punches the screen through the wall. Later room objects draw over it, so
            wall media stays behind furniture, photos, speech bubbles and every future 3D object. */}
        <mesh renderOrder={WALL_VIDEO_ORDER}><planeGeometry args={[screenWidth, screenHeight]} /><shaderMaterial side={2} depthWrite={false} vertexShader={VIDEO_MASK_VERTEX} fragmentShader={VIDEO_MASK_FRAGMENT} /></mesh>
        {/* No CSS matrix3d: iPhone Chrome and Safari share WebKit's iframe compositor and both drift there. The
            child receives one affine matrix calculated from these exact three projected screen corners. */}
        <Html calculatePosition={() => [0, 0]} wrapperClass="wall-video-portal" zIndexRange={WALL_HTML_Z_INDEX_RANGE} style={{ pointerEvents: 'none' }}>
        <div ref={element} className="wall-video" data-frame-id={frameId} style={{ width: 640, height: divHeight, pointerEvents: mode === 'edit' ? 'none' : 'auto' }}>
          {/* controls=0 keeps YouTube's control bar from popping over the wall screen (it auto-shows on tab
              return); the expanded panel player keeps its controls */}
          <ResumingIframe key={frameId} videoId={videoId} frameId={frameId} extra="autoplay=1&playsinline=1&mute=1&controls=0" frameStyle={{ width: 640 / cropWidth, height: divHeight / cropHeight, left: -640 * crop.left / cropWidth, top: -divHeight * crop.top / cropHeight, pointerEvents: mode === 'edit' ? 'none' : 'auto' }} />
          {/* the two shields carry the open-the-panel click and together cover everything but YouTube's own
              skip-ad corner, which is left live so the visitor can press it themselves */}
          {mode !== 'edit' && ['top', 'rest'].map((part) => <div key={part} className={`wall-video-shield ${part}`}
            onPointerDown={(event) => { event.stopPropagation(); startHold(event) }}
            onPointerUp={cancelHold} onPointerLeave={cancelHold} onPointerCancel={cancelHold}
            onClick={() => { if (held.current) { held.current = false; return } if (openObject(frameId)) return; openVideoPanel(frameId) }} />)}
        </div></Html>
      </group>
    </group>
  </FollowFit>
}

function FollowFit({ fitName, children }: { fitName: string; children: React.ReactNode }) {
  const holder = useRef<Group>(null)
  const parentInverse = useRef(new Matrix4())
  useFrame(({ scene }) => {
    const target = holder.current
    if (!target) return
    const fit = findFit(target, scene, fitName.replace('fit:', ''))
    if (!fit) return
    fit.updateWorldMatrix(true, false)
    target.parent?.updateWorldMatrix(true, false)
    target.matrix.copy(fit.matrixWorld)
    if (target.parent) target.matrix.premultiply(parentInverse.current.copy(target.parent.matrixWorld).invert())
    target.matrixAutoUpdate = false
    target.matrixWorldNeedsUpdate = true
  })
  return <group ref={holder}>{children}</group>
}

// src is fixed at mount (recomputing it would reload the embed); the tracker keeps the resume point fresh
export function ResumingIframe({ videoId, frameId, extra, frameStyle }: { videoId: string; frameId: string; extra: string; frameStyle?: React.CSSProperties }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [src] = useState(() => embedSrc(videoId, frameId, extra))
  useEffect(() => { if (frame.current) return trackIframe(frame.current, frameId) }, [frameId])
  return <iframe ref={frame} title="유튜브 재생" src={src} style={frameStyle} referrerPolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowFullScreen />
}
