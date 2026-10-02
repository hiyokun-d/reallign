// Data access layer — THE ONLY place the UI gets data from.
//
// Right now every function returns dummy data from lib/mock-data.ts.
// The backend team will swap the insides of these functions for the real
// source (Supabase, Dexie/IndexedDB fed over Bluetooth, etc.).
// As long as the function names and return types stay the same,
// no component has to change.
//
// Frontend devs: do NOT import lib/mock-data.ts directly in components.
// If you need data that isn't here yet, add a function below that returns
// mock data and tell the backend team.

import {
  mockDailySummaries,
  mockDevice,
  mockReadings,
  mockSessions,
} from "@/lib/mock-data"
import type {
  DailySummary,
  Device,
  PostureReading,
  PostureSession,
} from "@/lib/types"

// Fake network delay so loading states actually show up during development.
const delay = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms))

export async function getDevice(): Promise<Device> {
  await delay()
  return mockDevice
}

export async function getRecentReadings(limit = 60): Promise<PostureReading[]> {
  await delay()
  return mockReadings.slice(-limit)
}

export async function getLatestReading(): Promise<PostureReading> {
  await delay()
  return mockReadings[mockReadings.length - 1]
}

export async function getSessions(): Promise<PostureSession[]> {
  await delay()
  return mockSessions
}

export async function getDailySummaries(): Promise<DailySummary[]> {
  await delay()
  return mockDailySummaries
}
