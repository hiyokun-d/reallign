// /demo — private playground, not linked anywhere in the app.
// Open /demo on a laptop → it shows a QR code. Scan it with a phone → the
// phone opens /demo?join=CODE and streams its orientation to the laptop.
//
// This folder is sealed: it may only import npm packages and its own files,
// and nothing outside may import from it (enforced in eslint.config.mjs).

import type { Metadata } from "next";
import { DisplayView } from "./display-view";
import { SensorView } from "./sensor-view";

export const metadata: Metadata = {
  title: "lab",
  robots: { index: false, follow: false },
};

export default async function DemoPage({ searchParams }: PageProps<"/demo">) {
  const { join } = await searchParams;
  const code = typeof join === "string" ? join.toUpperCase() : null;

  return code ? <SensorView code={code} /> : <DisplayView />;
}
