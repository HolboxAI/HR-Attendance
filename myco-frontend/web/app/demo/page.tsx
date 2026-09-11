"use client";

import React from "react";
import { LiquidMetalButton } from "@/components/ui/liquid-metal-button";
import { LiquidMetalButtonDemo } from "@/components/ui/demo";
import Link from "next/link";
import { ArrowRight, ArrowLeft } from "lucide-react";

export default function DemoPage() {
  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-8 relative overflow-hidden">
      {/* Background ambient lighting */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[300px] bg-blue-500/10 rounded-full blur-[120px] pointer-events-none" />

      <div className="z-10 max-w-2xl w-full flex flex-col items-center gap-10">
        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-white/10 bg-white/5 text-xs text-white/70 font-mono">
            <span>Shader Component Showcase</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight font-display bg-gradient-to-r from-white via-white/90 to-white/60 bg-clip-text text-transparent">
            Liquid Metal Button
          </h1>
          <p className="text-sm text-white/50 max-w-md mx-auto">
            Interactive WebGL liquid metal fluid shaders powered by <code className="text-sky-400">@paper-design/shaders</code> with 3D perspective, responsive ripples, and specular highlights.
          </p>
        </div>

        {/* The Exact User Requested Demo */}
        <div className="p-8 rounded-3xl border border-white/10 bg-white/[0.03] backdrop-blur-xl flex flex-col items-center gap-6 w-full max-w-md">
          <span className="text-xs font-mono uppercase tracking-widest text-white/40">Default Demo</span>
          <LiquidMetalButtonDemo />
        </div>

        {/* Full-width Form Button Demo matching login page */}
        <div className="p-8 rounded-3xl border border-white/10 bg-white/[0.03] backdrop-blur-xl flex flex-col items-center gap-6 w-full max-w-md">
          <span className="text-xs font-mono uppercase tracking-widest text-white/40">Login / Signup Integration</span>
          <div className="w-full">
            <LiquidMetalButton
              type="button"
              width="100%"
              height={48}
              variant="liquid"
            >
              <div className="flex items-center justify-center gap-2 text-white text-sm font-semibold tracking-wide">
                <span>Sign in</span>
                <ArrowRight className="size-4 text-white" />
              </div>
            </LiquidMetalButton>
          </div>
        </div>

        {/* Navigation links */}
        <div className="flex items-center gap-4 text-xs font-mono">
          <Link
            href="/login"
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors text-white/80 hover:text-white"
          >
            <ArrowLeft className="size-3.5" />
            <span>Go to Login Page</span>
          </Link>
          <Link
            href="/signup"
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors text-white/80 hover:text-white"
          >
            <span>Go to Signup Page</span>
            <ArrowRight className="size-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
