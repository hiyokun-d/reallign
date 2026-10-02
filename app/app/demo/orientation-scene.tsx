"use client";

// 3D view of the sensor: a wireframe sphere with a "spine" and a "head".
// The rotation comes from a ref (not React state) so 30 updates/sec don't
// re-render React — useFrame reads it every animation frame and eases toward it.

import { Canvas, useFrame } from "@react-three/fiber";
import { useRef, type RefObject } from "react";
import { Quaternion, type Group } from "three";
import type { PostureStatus } from "@/lib/types";

const STATUS_COLORS: Record<PostureStatus, string> = {
  good: "#22c55e",
  warning: "#f59e0b",
  bad: "#ef4444",
};

function Body({ target, status }: { target: RefObject<Quaternion>; status: PostureStatus }) {
  const group = useRef<Group>(null);

  useFrame((_, delta) => {
    if (!group.current) return;
    // Frame-rate independent smoothing.
    group.current.quaternion.slerp(target.current, 1 - Math.exp(-delta * 12));
  });

  const color = STATUS_COLORS[status];

  return (
    <group ref={group}>
      <mesh>
        <sphereGeometry args={[1.4, 24, 16]} />
        <meshBasicMaterial color="#a3a3a3" wireframe transparent opacity={0.35} />
      </mesh>
      {/* spine */}
      <mesh>
        <cylinderGeometry args={[0.06, 0.06, 2.8, 12]} />
        <meshStandardMaterial color={color} />
      </mesh>
      {/* head */}
      <mesh position={[0, 1.4, 0]}>
        <sphereGeometry args={[0.22, 24, 16]} />
        <meshStandardMaterial color={color} />
      </mesh>
      {/* front marker (screen side of the phone) */}
      <mesh position={[0, 0.4, 0.35]}>
        <boxGeometry args={[0.5, 0.9, 0.06]} />
        <meshStandardMaterial color={color} transparent opacity={0.6} />
      </mesh>
    </group>
  );
}

export function OrientationScene({
  target,
  status,
}: {
  target: RefObject<Quaternion>;
  status: PostureStatus;
}) {
  return (
    <Canvas camera={{ position: [0, 0.6, 5], fov: 45 }} dpr={[1, 2]}>
      <ambientLight intensity={0.7} />
      <directionalLight position={[3, 5, 4]} intensity={1.2} />
      <Body target={target} status={status} />
    </Canvas>
  );
}
