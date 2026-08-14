import { useFBO } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { Color, Matrix4, type Mesh, OrthographicCamera, PerspectiveCamera, Plane, ShaderMaterial, Vector3 } from 'three'

// A planar mirror that works under this room's ORTHOGRAPHIC camera. drei's MeshReflectorMaterial cannot: it
// always builds a PerspectiveCamera and then rewrites the projection matrix with the oblique near-plane trick,
// whose algebra only holds for a perspective frustum — under an ortho projection the reflection comes out blank.
// Here the virtual camera matches the real one and geometry behind the glass is removed with a plain clipping
// plane instead, which is projection-agnostic.
const BIAS = new Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)

export default function MirrorGlass({ width, height, tint = '#e8eef2', strength = 0.9 }: { width: number; height: number; tint?: string; strength?: number }) {
  const mesh = useRef<Mesh>(null)
  const fbo = useFBO(768, 768, { samples: 2 })
  const scratch = useMemo(() => ({
    normal: new Vector3(), mirrorPos: new Vector3(), cameraPos: new Vector3(), view: new Vector3(),
    lookAt: new Vector3(), target: new Vector3(), up: new Vector3(), rotation: new Matrix4(), plane: new Plane(),
  }), [])
  const material = useMemo(() => new ShaderMaterial({
    uniforms: { map: { value: fbo.texture }, textureMatrix: { value: new Matrix4() }, tint: { value: new Color(tint) }, strength: { value: strength } },
    vertexShader: `uniform mat4 textureMatrix; varying vec4 vProjected;
      void main() { vProjected = textureMatrix * modelMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D map; uniform vec3 tint; uniform float strength; varying vec4 vProjected;
      void main() { vec3 reflected = texture2DProj(map, vProjected).rgb; gl_FragColor = vec4(mix(tint, reflected, strength), 1.0); }`,
  }), [fbo.texture, strength, tint])

  useFrame(({ gl, scene, camera }) => {
    const glass = mesh.current
    if (!glass) return
    const { normal, mirrorPos, cameraPos, view, lookAt, target, up, rotation, plane } = scratch
    glass.updateWorldMatrix(true, false)
    mirrorPos.setFromMatrixPosition(glass.matrixWorld)
    cameraPos.setFromMatrixPosition(camera.matrixWorld)
    rotation.extractRotation(glass.matrixWorld)
    normal.set(0, 0, 1).applyMatrix4(rotation).normalize()
    view.subVectors(mirrorPos, cameraPos)
    if (view.dot(normal) > 0) return // looking at the back of the glass — nothing to reflect
    view.reflect(normal).negate().add(mirrorPos)

    rotation.extractRotation(camera.matrixWorld)
    lookAt.set(0, 0, -1).applyMatrix4(rotation).add(cameraPos)
    target.subVectors(mirrorPos, lookAt).reflect(normal).negate().add(mirrorPos)
    up.set(0, 1, 0).applyMatrix4(rotation).reflect(normal)

    const virtual = (camera as OrthographicCamera).isOrthographicCamera ? orthoCamera : perspectiveCamera
    virtual.position.copy(view)
    virtual.up.copy(up)
    virtual.lookAt(target)
    virtual.near = camera.near
    virtual.far = camera.far
    virtual.updateMatrixWorld()
    virtual.projectionMatrix.copy(camera.projectionMatrix)
    virtual.projectionMatrixInverse.copy(camera.projectionMatrixInverse)

    material.uniforms.textureMatrix.value.copy(BIAS).multiply(virtual.projectionMatrix).multiply(virtual.matrixWorldInverse)

    // keep only what is in front of the glass, so the wall it leans against never leaks into the reflection
    plane.setFromNormalAndCoplanarPoint(normal, mirrorPos)
    const previousPlanes = gl.clippingPlanes
    const previousTarget = gl.getRenderTarget()
    gl.clippingPlanes = [plane]
    glass.visible = false
    gl.setRenderTarget(fbo)
    gl.render(scene, virtual)
    gl.setRenderTarget(previousTarget)
    glass.visible = true
    gl.clippingPlanes = previousPlanes
  })

  return <mesh ref={mesh} material={material}><planeGeometry args={[width, height]} /></mesh>
}

const orthoCamera = new OrthographicCamera()
const perspectiveCamera = new PerspectiveCamera()
