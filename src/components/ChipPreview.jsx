import React, { useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Environment } from '@react-three/drei'
import { generateChipGeometries } from '../utils/chip-geometry'

function ChipModel({ config }) {
  const parts = useMemo(() => {
    return generateChipGeometries(config)
  }, [
    config.name,
    config.value,
    config.style,
    config.diameter,
    config.thickness,
    config.textDepth,
    config.grooveCount,
    config.grooveRadius,
    config.rimWidth,
  ])

  return (
    <group>
      {parts.body && (
        <mesh geometry={parts.body}>
          <meshStandardMaterial color={config.colors.body} roughness={0.3} metalness={0.1} />
        </mesh>
      )}
      {parts.nameText && (
        <mesh geometry={parts.nameText}>
          <meshStandardMaterial color={config.colors.nameText} roughness={0.4} metalness={0.05} />
        </mesh>
      )}
      {parts.valueText && (
        <mesh geometry={parts.valueText}>
          <meshStandardMaterial color={config.colors.valueText} roughness={0.4} metalness={0.05} />
        </mesh>
      )}
      {parts.grooves && (
        <mesh geometry={parts.grooves}>
          <meshStandardMaterial color={config.colors.grooves} roughness={0.3} metalness={0.1} />
        </mesh>
      )}
      {parts.rimRing && (
        <mesh geometry={parts.rimRing}>
          <meshStandardMaterial color={config.colors.rimRing} roughness={0.2} metalness={0.3} />
        </mesh>
      )}
    </group>
  )
}

export default function ChipPreview({ config }) {
  const cameraDistance = config.diameter * 1.5

  return (
    <Canvas
      camera={{ position: [0, cameraDistance * 0.6, cameraDistance], fov: 45 }}
      style={{ background: '#1a1a2e' }}
    >
      <ambientLight intensity={0.4} />
      <pointLight position={[50, 50, 50]} intensity={1} />
      <pointLight position={[-30, -20, 40]} intensity={0.5} />
      <directionalLight position={[0, 30, 0]} intensity={0.6} />

      <ChipModel config={config} />

      <OrbitControls
        enablePan={true}
        enableZoom={true}
        enableRotate={true}
        minDistance={10}
        maxDistance={200}
      />

      <gridHelper args={[100, 20, '#333', '#222']} rotation={[0, 0, 0]} />
    </Canvas>
  )
}
