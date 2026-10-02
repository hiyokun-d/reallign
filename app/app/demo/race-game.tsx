"use client";

// Tilt Racer — endless road, dodge cones and crates, grab coins, speed ramps up.
// The simulation runs in refs inside useFrame (60fps, no React re-renders);
// React state is only used for the HUD (10x/sec) and the game phase.

import { Canvas, useFrame } from "@react-three/fiber";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Group, Mesh } from "three";
import { DemoButton } from "./ui";

/** Both -1..1. steer: + = right. throttle: + = faster. */
export type Controls = { steer: number; throttle: number };
type Phase = "ready" | "playing" | "over";
type Hud = { score: number; coins: number; speed: number };

const ROAD_HALF = 4;
const CAR_HALF_W = 0.55;
const CAR_HALF_L = 1;
const OBSTACLE_COUNT = 12;
const COIN_COUNT = 8;
const BEHIND_Z = 8;
const STRIPE_GAP = 6;
const STRIPE_COUNT = 30;
const COIN_POINTS = 50;
const BEST_KEY = "reallign-demo-best";

type Thing = { x: number; z: number };

const randX = (margin: number) => (Math.random() * 2 - 1) * (ROAD_HALF - margin);
const smooth = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

function World({
  phase,
  controls,
  onHud,
  onCrash,
}: {
  phase: Phase;
  controls: RefObject<() => Controls>;
  onHud: (hud: Hud) => void;
  onCrash: (score: number) => void;
}) {
  const car = useRef<Group>(null);
  const stripes = useRef<Group>(null);
  const obstacleMeshes = useRef<(Group | null)[]>([]);
  const coinMeshes = useRef<(Mesh | null)[]>([]);
  const sim = useRef({
    x: 0,
    targetX: 0,
    speed: 0,
    dist: 0,
    coins: 0,
    t: 0,
    hudT: 0,
    crashed: false,
    lastPhase: "ready" as Phase,
    obstacles: [] as Thing[],
    coinList: [] as Thing[],
  });

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const s = sim.current;

    // New run: reset everything and lay out the first obstacles/coins.
    if (phase === "playing" && s.lastPhase !== "playing") {
      Object.assign(s, { x: 0, targetX: 0, speed: 10, dist: 0, coins: 0, t: 0, hudT: 0, crashed: false });
      let z = -40;
      s.obstacles = Array.from({ length: OBSTACLE_COUNT }, () => {
        z -= 10 + Math.random() * 8;
        return { x: randX(0.6), z };
      });
      z = -25;
      s.coinList = Array.from({ length: COIN_COUNT }, () => {
        z -= 14 + Math.random() * 10;
        return { x: randX(1), z };
      });
    }
    s.lastPhase = phase;

    if (phase === "playing" && !s.crashed) {
      const c = controls.current();
      s.t += dt;
      const cruise = 14 + s.t * 0.4;
      s.speed += (cruise * (1 + 0.45 * c.throttle) - s.speed) * smooth(2, dt);
      s.targetX = c.steer * (ROAD_HALF - CAR_HALF_W);
      s.x += (s.targetX - s.x) * smooth(8, dt);

      const dz = s.speed * dt;
      s.dist += dz;

      let farthest = Math.min(...s.obstacles.map((o) => o.z));
      for (const o of s.obstacles) {
        o.z += dz;
        if (o.z > BEHIND_Z) {
          const gap = Math.max(6, 14 - s.t * 0.08) + Math.random() * 6;
          o.z = farthest - gap;
          o.x = randX(0.6);
          farthest = o.z;
        }
        if (Math.abs(o.z) < CAR_HALF_L + 0.45 && Math.abs(o.x - s.x) < CAR_HALF_W + 0.45) {
          s.crashed = true;
          onCrash(Math.floor(s.dist) + s.coins * COIN_POINTS);
        }
      }

      let farthestCoin = Math.min(...s.coinList.map((c) => c.z));
      for (const coin of s.coinList) {
        coin.z += dz;
        const collected = Math.abs(coin.z) < CAR_HALF_L + 0.4 && Math.abs(coin.x - s.x) < CAR_HALF_W + 0.4;
        if (collected) s.coins += 1;
        if (collected || coin.z > BEHIND_Z) {
          coin.z = farthestCoin - (14 + Math.random() * 10);
          coin.x = randX(1);
          farthestCoin = coin.z;
        }
      }

      s.hudT += dt;
      if (s.hudT > 0.1) {
        s.hudT = 0;
        onHud({
          score: Math.floor(s.dist) + s.coins * COIN_POINTS,
          coins: s.coins,
          speed: Math.round(s.speed * 3.6),
        });
      }
    } else if (phase === "ready") {
      s.dist += 6 * dt; // idle cruise on the title screen
    }

    // Push the simulation into the scene graph.
    if (car.current) {
      const drift = s.targetX - s.x;
      car.current.position.x = s.x;
      car.current.rotation.y = -drift * 0.12;
      car.current.rotation.z = -drift * 0.04;
    }
    if (stripes.current) stripes.current.position.z = s.dist % STRIPE_GAP;
    obstacleMeshes.current.forEach((m, i) => {
      const o = s.obstacles[i];
      if (!m) return;
      m.visible = phase !== "ready" && !!o;
      if (o) m.position.set(o.x, 0, o.z);
    });
    coinMeshes.current.forEach((m, i) => {
      const c = s.coinList[i];
      if (!m) return;
      m.visible = phase !== "ready" && !!c;
      if (c) m.position.set(c.x, 0.8, c.z);
      m.rotation.y += dt * 3;
    });

    const cam = state.camera;
    cam.position.x += (s.x * 0.6 - cam.position.x) * smooth(4, dt);
    cam.lookAt(s.x * 0.4, 0.4, -12);
  });

  return (
    <>
      <color attach="background" args={["#0b1020"]} />
      <fog attach="fog" args={["#0b1020", 30, 140]} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[4, 8, 6]} intensity={1.4} />

      {/* ground + road */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.02, -150]}>
        <planeGeometry args={[200, 400]} />
        <meshStandardMaterial color="#14301f" />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, -150]}>
        <planeGeometry args={[ROAD_HALF * 2 + 0.4, 400]} />
        <meshStandardMaterial color="#262b36" />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * (ROAD_HALF + 0.1), 0.01, -150]}>
          <boxGeometry args={[0.15, 0.02, 400]} />
          <meshStandardMaterial color="#f8fafc" />
        </mesh>
      ))}

      {/* moving lane stripes + roadside posts */}
      <group ref={stripes}>
        {Array.from({ length: STRIPE_COUNT }, (_, i) => (
          <group key={i} position={[0, 0, -i * STRIPE_GAP]}>
            {[-ROAD_HALF / 3, ROAD_HALF / 3].map((x) => (
              <mesh key={x} position={[x, 0.01, 0]}>
                <boxGeometry args={[0.12, 0.02, 2]} />
                <meshStandardMaterial color="#e2e8f0" />
              </mesh>
            ))}
            {[-1, 1].map((side) => (
              <mesh key={side} position={[side * (ROAD_HALF + 1.4), 0.5, 0]}>
                <boxGeometry args={[0.15, 1, 0.15]} />
                <meshStandardMaterial color={i % 2 ? "#f43f5e" : "#f8fafc"} />
              </mesh>
            ))}
          </group>
        ))}
      </group>

      {/* obstacles: even = cone, odd = crate */}
      {Array.from({ length: OBSTACLE_COUNT }, (_, i) => (
        <group key={i} ref={(m) => void (obstacleMeshes.current[i] = m)} visible={false}>
          {i % 2 === 0 ? (
            <>
              <mesh position={[0, 0.5, 0]}>
                <coneGeometry args={[0.45, 1, 16]} />
                <meshStandardMaterial color="#f97316" />
              </mesh>
              <mesh position={[0, 0.45, 0]}>
                <cylinderGeometry args={[0.24, 0.3, 0.15, 16]} />
                <meshStandardMaterial color="#f8fafc" />
              </mesh>
            </>
          ) : (
            <mesh position={[0, 0.45, 0]}>
              <boxGeometry args={[0.9, 0.9, 0.9]} />
              <meshStandardMaterial color="#a16207" />
            </mesh>
          )}
        </group>
      ))}

      {/* coins */}
      {Array.from({ length: COIN_COUNT }, (_, i) => (
        <mesh key={i} ref={(m) => void (coinMeshes.current[i] = m)} visible={false}>
          <torusGeometry args={[0.35, 0.12, 12, 24]} />
          <meshStandardMaterial color="#facc15" emissive="#a16207" metalness={0.6} roughness={0.3} />
        </mesh>
      ))}

      {/* car (front points to -z) */}
      <group ref={car}>
        <mesh position={[0, 0.4, 0]}>
          <boxGeometry args={[CAR_HALF_W * 2, 0.4, CAR_HALF_L * 2]} />
          <meshStandardMaterial color="#e11d48" />
        </mesh>
        <mesh position={[0, 0.75, 0.15]}>
          <boxGeometry args={[0.8, 0.35, 0.9]} />
          <meshStandardMaterial color="#1e293b" />
        </mesh>
        {[-1, 1].flatMap((sx) =>
          [-1, 1].map((sz) => (
            <mesh key={`${sx}${sz}`} position={[sx * CAR_HALF_W, 0.22, sz * 0.65]} rotation-z={Math.PI / 2}>
              <cylinderGeometry args={[0.22, 0.22, 0.2, 16]} />
              <meshStandardMaterial color="#0f172a" />
            </mesh>
          ))
        )}
      </group>
    </>
  );
}

export function RaceGame({
  getControls,
  inputLabel,
  onStart,
}: {
  /** Called every frame while playing. */
  getControls: () => Controls;
  /** e.g. "Phone" or "Keyboard" — shown on the title screen. */
  inputLabel: string;
  /** Called right before a run starts (used to calibrate the phone). */
  onStart: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("ready");
  const [hud, setHud] = useState<Hud>({ score: 0, coins: 0, speed: 0 });
  const [best, setBest] = useState(0);
  const [lastScore, setLastScore] = useState(0);

  // Always call the latest getControls without restarting the frame loop.
  const controls = useRef(getControls);
  useEffect(() => {
    controls.current = getControls;
  }, [getControls]);

  const start = useCallback(() => {
    // Load the saved best score on the first run (localStorage isn't available during SSR).
    setBest((prev) => {
      if (prev > 0) return prev;
      try {
        return Number(localStorage.getItem(BEST_KEY)) || 0;
      } catch {
        return 0;
      }
    });
    onStart();
    setHud({ score: 0, coins: 0, speed: 0 });
    setPhase("playing");
  }, [onStart]);

  const crash = useCallback((score: number) => {
    setLastScore(score);
    setPhase("over");
    setBest((prev) => {
      const next = Math.max(prev, score);
      try {
        localStorage.setItem(BEST_KEY, String(next));
      } catch {}
      return next;
    });
  }, []);

  // Space / Enter starts or restarts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.code === "Space" || e.code === "Enter") && phase !== "playing") {
        e.preventDefault();
        start();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, start]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl">
      <Canvas camera={{ position: [0, 3.2, 7], fov: 60 }} dpr={[1, 2]}>
        <World phase={phase} controls={controls} onHud={setHud} onCrash={crash} />
      </Canvas>

      {phase === "playing" && (
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-between p-4 font-mono text-white">
          <div className="text-3xl font-bold tabular-nums drop-shadow">{hud.score}</div>
          <div className="text-right text-sm tabular-nums drop-shadow">
            <div>🪙 {hud.coins}</div>
            <div>{hud.speed} km/h</div>
          </div>
        </div>
      )}

      <AnimatePresence>
        {phase !== "playing" && (
          <motion.div
            key={phase}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.05 }}
            transition={{ duration: 0.25 }}
            className="absolute inset-0 grid place-items-center bg-black/40 text-center text-white"
          >
            <div className="flex flex-col items-center gap-3">
              <h2 className="text-4xl font-black italic tracking-tight">
                {phase === "ready" ? "TILT RACER" : "CRASHED!"}
              </h2>
              {phase === "over" && (
                <p className="font-mono text-lg tabular-nums">
                  score {lastScore} · best {best}
                </p>
              )}
              {phase === "ready" && best > 0 && <p className="font-mono text-sm">best {best}</p>}
              <p className="max-w-xs text-sm text-white/80">
                {inputLabel === "Phone"
                  ? "Hold your phone up, screen facing you. Tilt left/right to steer, tip forward to go faster."
                  : "← → to steer, ↑ ↓ for speed. Connect a phone to steer by tilting."}
              </p>
              <DemoButton onClick={start} className="mt-2">
                {phase === "ready" ? "Start" : "Again"} <span className="ml-2 opacity-60">space</span>
              </DemoButton>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
