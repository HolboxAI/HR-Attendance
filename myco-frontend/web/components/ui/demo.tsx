"use client";

import React from "react";
import { motion } from "framer-motion";
import { AuroraBackground } from "@/components/ui/aurora-background";
import { Component as VelocityTextComponent } from "@/components/ui/velocity-text";
import { MenuToggle } from "@/components/ui/menu-toggle";
import { AnimatedThemeToggle } from "@/components/ui/animated-theme-toggle";
import KineticTeamList from "@/components/ui/kinetic-team-hybrid";
import StatsBento from "@/components/ui/stats-bento";
import { ParticleWave } from "@/components/ui/particle-wave";
import { GlowCard } from "@/components/ui/spotlight-card";
import { SignInPage } from "@/components/ui/sign-in-flow-1";
import { LiquidMetalButton } from "@/components/ui/liquid-metal-button";

export function AuroraBackgroundDemo() {
  return (
    <AuroraBackground>
      <motion.div
        initial={{ opacity: 0.0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{
          delay: 0.3,
          duration: 0.8,
          ease: "easeInOut",
        }}
        className="relative flex flex-col gap-4 items-center justify-center px-4 py-20"
      >
        <div className="text-3xl md:text-7xl font-bold dark:text-white text-center font-display">
          Background lights are cool you know.
        </div>
        <div className="font-extralight text-base md:text-4xl dark:text-neutral-200 py-4 font-body">
          And this, is chemical burn.
        </div>
        <button className="bg-black dark:bg-white rounded-full w-fit text-white dark:text-black px-6 py-2.5 font-medium shadow-lg hover:scale-105 transition-transform active:scale-95">
          Debug now
        </button>
      </motion.div>
    </AuroraBackground>
  );
}

export const MenuToggleDemo = () => {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="flex min-h-screen w-full items-center justify-center">
      <MenuToggle strokeWidth={3} open={open} onOpenChange={setOpen} className="size-16" />
    </div>
  );
};

export function StatsBentoDemo() {
  return <StatsBento />;
}

export function ParticleWaveDemo() {
  return (
    <div className="relative w-full h-screen bg-background overflow-hidden">
      <ParticleWave />
      <div className="absolute top-4 left-4 z-10 text-foreground/80 text-sm font-mono">
        <p>Particle Wave Animation</p>
        <p className="text-xs opacity-60 mt-1">Move your mouse to interact</p>
      </div>
    </div>
  );
}

export function Default() {
  return (
    <div className="w-screen h-screen flex flex-row items-center justify-center gap-10">
      <GlowCard glowColor="monochrome">
        <div className="text-ink font-bold font-display text-lg">Card 01</div>
      </GlowCard>
      <GlowCard glowColor="monochrome">
        <div className="text-ink font-bold font-display text-lg">Card 02</div>
      </GlowCard>
      <GlowCard glowColor="monochrome">
        <div className="text-ink font-bold font-display text-lg">Card 03</div>
      </GlowCard>
    </div>
  );
}

export function SignInPageDemo() {
  return (
    <div className="flex w-full h-screen justify-center items-center">
      <SignInPage />
    </div>
  );
}

export default function DemoOne() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center gap-6 p-8">
      <AnimatedThemeToggle />
    </div>
  );
}

export function LiquidMetalButtonDemo() {
  return (
    <div className="flex flex-col items-center justify-center gap-8 p-8">
      <div className="flex items-center gap-8">
        <LiquidMetalButton label="Get Started" />
        <LiquidMetalButton label="Sign in →" width="180px" height={46} />
      </div>
      <div className="w-72">
        <LiquidMetalButton label="Submit Registration" width="100%" height={48} />
      </div>
    </div>
  );
}

export { DemoOne as AnimatedThemeToggleDemo, Default as GlowCardDemo };
