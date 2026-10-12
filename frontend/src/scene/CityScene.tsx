import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTexture } from "@react-three/drei";
import { SRGBColorSpace, type Group, type Mesh } from "three";

interface CityArtworkProps {
  progress: number;
  reducedMotion: boolean;
  onLoaded(): void;
}

function CityArtwork({ progress, reducedMotion, onLoaded }: CityArtworkProps) {
  const group = useRef<Group>(null);
  const plane = useRef<Mesh>(null);
  const { size } = useThree();
  const texture = useTexture("/assets/city-safety-hero.png");

  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;

  useEffect(() => onLoaded(), [onLoaded]);

  const fitScale = useMemo(() => {
    const viewportWidth = size.width / 80;
    const viewportHeight = size.height / 80;
    return Math.min(viewportWidth / 12, viewportHeight / 9) * (size.width < 760 ? 0.96 : 0.68);
  }, [size.height, size.width]);

  useFrame((_, delta) => {
    if (!group.current || !plane.current) return;
    const targetScale = fitScale * (reducedMotion ? 1 : 1.035 + progress * 0.055);
    const targetX = size.width < 760 ? 0 : 3.55 - progress * 0.35;
    const targetY = size.width < 760 ? 0 : 1.2 - progress * 0.14;
    const ease = 1 - Math.exp(-delta * 2.2);
    group.current.scale.x += (targetScale - group.current.scale.x) * ease;
    group.current.scale.y += (targetScale - group.current.scale.y) * ease;
    group.current.scale.z += (targetScale - group.current.scale.z) * ease;
    group.current.position.x += (targetX - group.current.position.x) * ease;
    group.current.position.y += (targetY - group.current.position.y) * ease;
    const targetRotation = Math.sin(performance.now() / 5000) * 0.012 + progress * 0.004;
    plane.current.rotation.z += (targetRotation - plane.current.rotation.z) * ease;
  });

  return (
    <group ref={group} scale={fitScale * 1.035} position={[size.width < 760 ? 0 : 3.55, 1.2, 0]}>
      <mesh ref={plane}>
        <planeGeometry args={[12, 9]} />
        <meshBasicMaterial map={texture} transparent alphaTest={0.015} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

export interface CitySceneProps {
  progress: number;
  reducedMotion: boolean;
}

export function CityScene({ progress, reducedMotion }: CitySceneProps) {
  const [sceneReady, setSceneReady] = useState(false);
  const onLoaded = useCallback(() => setSceneReady(true), []);
  const fallback = (
    <img
      className="city-scene-fallback"
      src="/assets/city-safety-hero.png"
      alt="Diorama kota dengan rute bercahaya dan penanda lokasi darurat"
    />
  );

  return (
    <div className="city-scene-shell">
      <img
        className={`city-scene-underlay ${sceneReady ? "scene-ready" : ""} ${reducedMotion ? "scene-static" : ""}`}
        src="/assets/city-safety-hero.png"
        alt=""
        aria-hidden="true"
      />
      {!reducedMotion && (
        <Canvas
          className="city-scene-canvas"
          orthographic
          camera={{ position: [0, 0, 20], zoom: 80, near: 0.1, far: 100 }}
          dpr={[1, 1.5]}
          gl={{ alpha: true, antialias: true, powerPreference: "low-power" }}
          fallback={fallback}
          aria-hidden="true"
        >
          <Suspense fallback={null}>
            <CityArtwork progress={progress} reducedMotion={reducedMotion} onLoaded={onLoaded} />
          </Suspense>
        </Canvas>
      )}
    </div>
  );
}
