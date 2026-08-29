"use client"

import { useEffect, useState } from "react"
import { Moon, Sun } from "lucide-react"
import { cn } from "@/lib/utils"
import { applyTheme } from "@/components/ThemeToggle"

const KEY = "bx-theme"

/**
 * The sliding moon/sun pill. The visuals are the imported component verbatim;
 * the wiring is ours - its demo kept theme in local state, which would flip
 * the knob without changing a single pixel of the page. Here the click drives
 * the same mechanism the layout's before-paint script reads: `bx-theme` in
 * localStorage plus applyTheme()'s class on <html>, so the choice sticks
 * across reloads and there is no flash on the next visit.
 */
export function ThemeToggle({ className }: { className?: string }) {
  // Starts false on the server and corrects itself on mount - the same
  // hydration-safe pattern the previous toggle used.
  const [isDark, setIsDark] = useState(false)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(KEY)
      setIsDark(
        stored === "dark"
        || document.documentElement.classList.contains("bx-dark-mode"),
      )
    } catch {
      /* private mode - the light default stands */
    }
  }, [])

  const toggle = () => {
    const next = !isDark
    setIsDark(next)
    try {
      localStorage.setItem(KEY, next ? "dark" : "light")
    } catch {
      /* fine - applies for this visit only */
    }
    applyTheme(next ? "dark" : "light")
  }

  return (
    <div
      className={cn(
        "flex w-16 h-8 p-1 rounded-full cursor-pointer transition-all duration-300",
        isDark
          ? "bg-zinc-950 border border-zinc-800"
          : "bg-white border border-zinc-200",
        className
      )}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          toggle()
        }
      }}
      role="button"
      tabIndex={0}
      aria-pressed={isDark}
      aria-label={isDark ? "Dark theme. Activate to switch to light." : "Light theme. Activate to switch to dark."}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
    >
      <div className="flex justify-between items-center w-full">
        <div
          className={cn(
            "flex justify-center items-center w-6 h-6 rounded-full transition-transform duration-300",
            isDark
              ? "transform translate-x-0 bg-zinc-800"
              : "transform translate-x-8 bg-gray-200"
          )}
        >
          {isDark ? (
            <Moon
              className="w-4 h-4 text-white"
              strokeWidth={1.5}
            />
          ) : (
            <Sun
              className="w-4 h-4 text-gray-700"
              strokeWidth={1.5}
            />
          )}
        </div>
        <div
          className={cn(
            "flex justify-center items-center w-6 h-6 rounded-full transition-transform duration-300",
            isDark
              ? "bg-transparent"
              : "transform -translate-x-8"
          )}
        >
          {isDark ? (
            <Sun
              className="w-4 h-4 text-gray-500"
              strokeWidth={1.5}
            />
          ) : (
            <Moon
              className="w-4 h-4 text-black"
              strokeWidth={1.5}
            />
          )}
        </div>
      </div>
    </div>
  )
}
