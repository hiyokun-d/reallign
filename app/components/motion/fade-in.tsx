"use client"

// Reusable Motion wrappers. Server components can't use `motion.*` directly
// (it needs the browser), so wrap server-rendered content in these instead.
//
//   <FadeIn delay={0.1}><Card>...</Card></FadeIn>
//
//   <Stagger>
//     <StaggerItem>...</StaggerItem>
//     <StaggerItem>...</StaggerItem>
//   </Stagger>

import { motion, type HTMLMotionProps } from "motion/react"

type FadeInProps = HTMLMotionProps<"div"> & { delay?: number }

export function FadeIn({ delay = 0, ...props }: FadeInProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut", delay }}
      {...props}
    />
  )
}

export function Stagger(props: HTMLMotionProps<"div">) {
  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={{ show: { transition: { staggerChildren: 0.08 } } }}
      {...props}
    />
  )
}

export function StaggerItem(props: HTMLMotionProps<"div">) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 12 },
        show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" } },
      }}
      {...props}
    />
  )
}
