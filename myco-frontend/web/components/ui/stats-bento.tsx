"use client";
import React from "react";

export const StatsBento = () => {
  return (
    <section className="min-h-screen bg-background flex flex-col justify-center p-6">
      <div className="grid grid-cols-1 md:grid-cols-6 md:grid-rows-2 gap-4 max-w-7xl mx-auto w-full">
        {/* Primary Stat */}
        <div className="md:col-span-3 md:row-span-2 bg-primary rounded-3xl p-10 flex flex-col justify-between overflow-hidden relative border border-line">
          <div className="absolute bottom-0 left-0 right-0 top-0 bg-[repeating-linear-gradient(45deg,#808080_0px_1px,transparent_1px_10px)] opacity-30 mask-[radial-gradient(ellipse_80%_50%_at_100%_0%,#000_70%,transparent_110%)] pointer-events-none"></div>
          <div>
            <span className="inline-block px-3 py-1 bg-primary-foreground/10 rounded-full text-[10px] font-semibold text-primary-foreground/60 uppercase tracking-widest mb-6">
              Market Share
            </span>
            <h3 className="text-6xl font-black tracking-tighter text-primary-foreground ">
              64%
            </h3>
          </div>
          <p className="text-primary-foreground/60 text-sm max-w-xs">
            Dominating the cloud-native infrastructure market for venture-backed
            startups.
          </p>
        </div>

        {/* Secondary Stat A */}
        <div className="md:col-span-3 bg-muted rounded-3xl p-8 border border-border flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">
              Growth
            </p>
            <p className="text-3xl font-bold text-foreground ">+240%</p>
          </div>
          <div className="flex gap-1 items-end h-8">
            {[10, 20, 40, 30, 60, 50, 80, 70, 90, 100, 110].map((h, i) => (
              <div
                key={i}
                className="w-1.5 bg-foreground rounded-full"
                style={{ height: `${h}%` }}
              />
            ))}
          </div>
        </div>

        {/* Tertiary Stat B */}
        <div className="md:col-span-1 bg-card rounded-3xl p-6 border border-border flex flex-col justify-center text-center">
          <p className="text-2xl font-bold text-foreground">12</p>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Awards
          </p>
        </div>

        {/* Tertiary Stat C */}
        <div className="md:col-span-2 bg-muted rounded-3xl p-6 flex items-center gap-4">
          <div className="size-10 text-2xl rounded-full bg-background text-foreground flex items-center justify-center shrink-0 shadow-sm font-semibold">
            ★
          </div>
          <div>
            <p className="text-sm font-bold text-foreground leading-none">4.9 / 5.0</p>
            <p className="text-xs font-semibold text-muted-foreground mt-1">
              G2 Peer Reviews
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};

export default StatsBento;
