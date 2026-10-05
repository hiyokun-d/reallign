"use client";

// Laptop side of the phone link: opens a PeerJS id, waits for the phone,
// and keeps the phone's orientation (relative to calibration) in refs so
// consumers can read it every frame without React re-renders.

import type { Peer } from "peerjs";
import { useCallback, useEffect, useRef, useState } from "react";
import { Quaternion } from "three";
import { packetToQuaternion } from "./math";
import { makeCode, PEER_PREFIX, type OrientationPacket } from "./protocol";

export type LinkStatus = "starting" | "waiting" | "connected" | "error";

/** enabled = false skips the pairing server entirely (phones use the ESP32 directly). */
export function usePhoneLink(enabled = true) {
  const [status, setStatus] = useState<LinkStatus>("starting");
  const [code, setCode] = useState<string | null>(null);
  const [joinUrl, setJoinUrl] = useState<string | null>(null);

  const latest = useRef<Quaternion | null>(null);
  const baseline = useRef<Quaternion | null>(null);
  const relative = useRef(new Quaternion());

  useEffect(() => {
    if (!enabled) return;
    let peer: Peer | null = null;
    let cancelled = false;

    async function connect(attempt = 0) {
      const { default: PeerCtor } = await import("peerjs");
      if (cancelled) return;
      const newCode = makeCode();
      peer = new PeerCtor(PEER_PREFIX + newCode);

      peer.on("open", () => {
        setCode(newCode);
        setJoinUrl(`${window.location.origin}/demo?join=${newCode}`);
        setStatus("waiting");
      });

      peer.on("connection", (conn) => {
        conn.on("open", () => {
          baseline.current = null; // recalibrate on every new phone
          setStatus("connected");
        });
        conn.on("data", (data) => {
          const q = packetToQuaternion(data as OrientationPacket);
          latest.current = q;
          baseline.current ??= q.clone();
          relative.current.copy(baseline.current).invert().multiply(q);
        });
        conn.on("close", () => {
          latest.current = null;
          setStatus("waiting");
        });
      });

      peer.on("error", (err) => {
        if (err.type === "unavailable-id" && attempt < 3) {
          peer?.destroy();
          connect(attempt + 1);
          return;
        }
        setStatus("error");
      });
    }

    connect();
    return () => {
      cancelled = true;
      peer?.destroy();
    };
  }, [enabled]);

  /** Make the phone's current pose the new "zero". */
  const calibrate = useCallback(() => {
    if (!latest.current) return;
    baseline.current = latest.current.clone();
    relative.current.identity();
  }, []);

  /** True once at least one packet arrived from a connected phone. */
  const hasData = useCallback(() => latest.current !== null, []);

  return { status, code, joinUrl, relative, calibrate, hasData };
}
