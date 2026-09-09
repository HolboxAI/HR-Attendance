'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
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

const HoverProfileContext = createContext<HoverProfileContextType | null>(null);

export function HoverProfileProvider({ children }: { children: React.ReactNode }) {
  const [activeProfile, setActiveProfile] = useState<ProfileData | null>(null);
  
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const pathname = usePathname();

  useEffect(() => {
    setActiveProfile(null);
  }, [pathname]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      // Offset cursor slightly so it doesn't cover the mouse pointer
      mouseX.set(e.clientX + 20);
      mouseY.set(e.clientY + 20);
    };

    window.addEventListener('mousemove', handleMouseMove);
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

  const springConfig = { damping: 25, stiffness: 300, mass: 0.5 };
  const cursorX = useSpring(mouseX, springConfig);
  const cursorY = useSpring(mouseY, springConfig);

  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [activeProfile]);

  return (
    <motion.div
      style={{ x: cursorX, y: cursorY }}
      className="pointer-events-none fixed left-0 top-0 z-50 hidden md:block"
    >
      <AnimatePresence mode="wait">
        {activeProfile && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8, filter: "blur(4px)" }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.8, filter: "blur(4px)" }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            className="relative h-64 w-64 overflow-hidden rounded-xl border border-line bg-surface shadow-2xl"
          >
            <div className="absolute inset-0">
              {activeProfile.code && !imgError ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={proxy(`/api/v1/admin/employees/directory/${activeProfile.code}/photo`)}
                  alt={activeProfile.name ?? 'Profile'}
                  className="size-full object-cover"
                  onError={() => setImgError(true)}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-surface-2 [&>span]:size-full [&>span]:rounded-none [&>span]:text-[80px]">
                  <Avatar name={activeProfile.name ?? 'User'} />
                </div>
              )}
            </div>
            
            {/* Overlay Metadata */}
            <div className="absolute bottom-0 w-full bg-linear-to-t from-black/80 via-black/40 to-transparent p-4 pt-12">
              <h3 className="font-display text-lg font-bold text-white shadow-black drop-shadow-md">
                {activeProfile.name}
              </h3>
              {(activeProfile.role || activeProfile.department) && (
                <p className="mt-0.5 text-[10px] font-mono text-white/80 uppercase tracking-widest drop-shadow-md">
                  {activeProfile.role}
                  {activeProfile.role && activeProfile.department && ' · '}
                  {activeProfile.department}
                </p>
              )}
            </div>
            
            <div className="absolute top-4 right-4 flex items-center gap-2 drop-shadow-md">
              <div className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse ring-2 ring-black/20" />
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
  className = ''
}: {
  children: React.ReactNode;
  data: ProfileData;
  className?: string;
}) {
  const ctx = useContext(HoverProfileContext);

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
