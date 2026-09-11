'use client';

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { motion, useMotionValue, useSpring, AnimatePresence } from 'framer-motion';
import { Avatar } from '@/components/Avatar';
import { proxy } from '@/lib/format';

type ProfileData = {
  name: string | null;
  code?: string | null;
  role?: string | null;
  department?: string | null;
};

type HoverProfileContextType = {
  activeProfile: ProfileData | null;
  setActiveProfile: (profile: ProfileData | null) => void;
  mouseX: any;
  mouseY: any;
};

const preloadedPhotos = new Set<string>();
export function preloadProfilePhoto(code?: string | null) {
  if (!code || typeof window === 'undefined' || preloadedPhotos.has(code)) return;
  preloadedPhotos.add(code);
  const img = new Image();
  img.src = proxy(`/api/v1/admin/employees/directory/${code}/photo`);
}

const HoverProfileContext = createContext<HoverProfileContextType | null>(null);

export function HoverProfileProvider({ children }: { children: React.ReactNode }) {
  const [activeProfile, setActiveProfileState] = useState<ProfileData | null>(null);
  const leaveTimerRef = useRef<NodeJS.Timeout | null>(null);

  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const pathname = usePathname();

  const setActiveProfile = (profile: ProfileData | null) => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }

    if (profile) {
      // Immediate switch with zero delay when hovering over a profile
      setActiveProfileState(profile);
      if (profile.code) preloadProfilePhoto(profile.code);
    } else {
      // Tiny grace period (50ms) so moving across adjacent rows doesn't trigger exit lag
      leaveTimerRef.current = setTimeout(() => {
        setActiveProfileState(null);
      }, 50);
    }
  };

  useEffect(() => {
    setActiveProfileState(null);
  }, [pathname]);

  const activeProfileRef = useRef<ProfileData | null>(null);
  activeProfileRef.current = activeProfile;

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!activeProfileRef.current) return;
      const cardW = 260;
      const cardH = 260;
      let x = e.clientX + 16;
      let y = e.clientY + 16;
      if (typeof window !== 'undefined') {
        if (x + cardW > window.innerWidth - 10) {
          x = e.clientX - cardW - 16;
        }
        if (y + cardH > window.innerHeight - 10) {
          y = e.clientY - cardH - 16;
        }
      }
      mouseX.set(x);
      mouseY.set(y);
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [mouseX, mouseY]);

  return (
    <HoverProfileContext.Provider value={{ activeProfile, setActiveProfile, mouseX, mouseY }}>
      {children}
    </HoverProfileContext.Provider>
  );
}

export function HoverCursorPreview() {
  const ctx = useContext(HoverProfileContext);
  if (!ctx) return null;

  const { activeProfile, mouseX, mouseY } = ctx;

  // Super snappy, zero-lag cursor follower
  const springConfig = { damping: 30, stiffness: 600, mass: 0.1 };
  const cursorX = useSpring(mouseX, springConfig);
  const cursorY = useSpring(mouseY, springConfig);

  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [activeProfile?.code]);

  return (
    <motion.div
      style={{ x: cursorX, y: cursorY }}
      className="pointer-events-none fixed left-0 top-0 z-50 hidden md:block"
    >
      <AnimatePresence>
        {activeProfile && (
          <motion.div
            key={activeProfile.code || activeProfile.name || 'preview'}
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.94 }}
            transition={{ duration: 0.1, ease: 'easeOut' }}
            className="relative h-64 w-64 overflow-hidden rounded-xl border border-line bg-surface shadow-2xl"
          >
            {/* Immediate Base Layer: Always render avatar instantly */}
            <div className="absolute inset-0 flex h-full w-full items-center justify-center bg-surface-2 [&>span]:size-full [&>span]:rounded-none [&>span]:text-[80px]">
              <Avatar name={activeProfile.name ?? 'User'} />
            </div>

            {/* Photo Layer on top */}
            {activeProfile.code && !imgError && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={proxy(`/api/v1/admin/employees/directory/${activeProfile.code}/photo`)}
                alt={activeProfile.name ?? 'Profile'}
                className="size-full object-cover absolute inset-0 z-1"
                onError={() => setImgError(true)}
              />
            )}

            {/* Overlay Metadata */}
            <div className="absolute bottom-0 w-full z-2 bg-linear-to-t from-black/80 via-black/40 to-transparent p-4 pt-12">
              <h3 className="font-display text-lg font-bold text-white shadow-black drop-shadow-md truncate">
                {activeProfile.name}
              </h3>
              {(activeProfile.role || activeProfile.department) && (
                <p className="mt-0.5 text-[10px] font-mono text-white/80 uppercase tracking-widest drop-shadow-md truncate">
                  {activeProfile.role}
                  {activeProfile.role && activeProfile.department && ' · '}
                  {activeProfile.department}
                </p>
              )}
            </div>

            <div className="absolute top-4 right-4 z-2 flex items-center gap-2 drop-shadow-md">
              <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse ring-2 ring-black/30" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function HoverProfile({
  children,
  data,
  className = '',
}: {
  children: React.ReactNode;
  data: ProfileData;
  className?: string;
}) {
  const ctx = useContext(HoverProfileContext);

  // Preload photo immediately when component renders so it's in browser cache instantly
  useEffect(() => {
    if (data?.code) {
      preloadProfilePhoto(data.code);
    }
  }, [data?.code]);

  return (
    <span
      className={`inline-block relative z-10 cursor-default ${className}`}
      onMouseEnter={() => ctx?.setActiveProfile(data)}
      onMouseLeave={() => ctx?.setActiveProfile(null)}
      onMouseDown={() => ctx?.setActiveProfile(null)}
      onClick={() => ctx?.setActiveProfile(null)}
    >
      {children}
    </span>
  );
}
