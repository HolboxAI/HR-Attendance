import React, { useEffect, useRef } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

interface Vector2D {
  x: number;
  y: number;
}

class Particle {
  pos: Vector2D = { x: 0, y: 0 };
  vel: Vector2D = { x: 0, y: 0 };
  acc: Vector2D = { x: 0, y: 0 };
  target: Vector2D = { x: 0, y: 0 };

  closeEnoughTarget = 100;
  maxSpeed = 1.0;
  maxForce = 0.1;
  particleSize = 10;
  isKilled = false;

  startColor = { r: 0, g: 0, b: 0 };
  targetColor = { r: 0, g: 0, b: 0 };
  colorWeight = 0;
  colorBlendRate = 0.01;

  move() {
    let proximityMult = 1;
    const distance = Math.sqrt(Math.pow(this.pos.x - this.target.x, 2) + Math.pow(this.pos.y - this.target.y, 2));

    if (distance < this.closeEnoughTarget) {
      proximityMult = distance / this.closeEnoughTarget;
    }

    const towardsTarget = {
      x: this.target.x - this.pos.x,
      y: this.target.y - this.pos.y,
    };

    const magnitude = Math.sqrt(towardsTarget.x * towardsTarget.x + towardsTarget.y * towardsTarget.y);
    if (magnitude > 0) {
      towardsTarget.x = (towardsTarget.x / magnitude) * this.maxSpeed * proximityMult;
      towardsTarget.y = (towardsTarget.y / magnitude) * this.maxSpeed * proximityMult;
    }

    const steer = {
      x: towardsTarget.x - this.vel.x,
      y: towardsTarget.y - this.vel.y,
    };

    const steerMagnitude = Math.sqrt(steer.x * steer.x + steer.y * steer.y);
    if (steerMagnitude > 0) {
      steer.x = (steer.x / steerMagnitude) * this.maxForce;
      steer.y = (steer.y / steerMagnitude) * this.maxForce;
    }

    this.acc.x += steer.x;
    this.acc.y += steer.y;

    this.vel.x += this.acc.x;
    this.vel.y += this.acc.y;
    this.pos.x += this.vel.x;
    this.pos.y += this.vel.y;
    this.acc.x = 0;
    this.acc.y = 0;
  }

  draw(ctx: CanvasRenderingContext2D, drawAsPoints: boolean) {
    if (this.colorWeight < 1.0) {
      this.colorWeight = Math.min(this.colorWeight + this.colorBlendRate, 1.0);
    }

    const currentColor = {
      r: Math.round(this.startColor.r + (this.targetColor.r - this.startColor.r) * this.colorWeight),
      g: Math.round(this.startColor.g + (this.targetColor.g - this.startColor.g) * this.colorWeight),
      b: Math.round(this.startColor.b + (this.targetColor.b - this.startColor.b) * this.colorWeight),
    };

    if (drawAsPoints) {
      ctx.fillStyle = `rgb(${currentColor.r}, ${currentColor.g}, ${currentColor.b})`;
      ctx.fillRect(this.pos.x, this.pos.y, 2.5, 2.5);
    } else {
      ctx.fillStyle = `rgb(${currentColor.r}, ${currentColor.g}, ${currentColor.b})`;
      ctx.beginPath();
      ctx.arc(this.pos.x, this.pos.y, this.particleSize / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  kill(width: number, height: number) {
    if (!this.isKilled) {
      const randomPos = this.generateRandomPos(width / 2, height / 2, (width + height) / 2);
      this.target.x = randomPos.x;
      this.target.y = randomPos.y;

      this.startColor = {
        r: this.startColor.r + (this.targetColor.r - this.startColor.r) * this.colorWeight,
        g: this.startColor.g + (this.targetColor.g - this.startColor.g) * this.colorWeight,
        b: this.startColor.b + (this.targetColor.b - this.startColor.b) * this.colorWeight,
      };
      this.targetColor = { r: 0, g: 0, b: 0 };
      this.colorWeight = 0;

      this.isKilled = true;
    }
  }

  private generateRandomPos(x: number, y: number, mag: number): Vector2D {
    const randomX = Math.random() * 1000;
    const randomY = Math.random() * 500;

    const direction = {
      x: randomX - x,
      y: randomY - y,
    };

    const magnitude = Math.sqrt(direction.x * direction.x + direction.y * direction.y);
    if (magnitude > 0) {
      direction.x = (direction.x / magnitude) * mag;
      direction.y = (direction.y / magnitude) * mag;
    }

    return {
      x: x + direction.x,
      y: y + direction.y,
    };
  }
}

interface MobileParticleEffectProps {
  words?: string[];
  width?: number;
  height?: number;
}

const DEFAULT_WORDS = ['HOLBOX', 'ATTENDANCE', 'PORTAL'];

export function MobileParticleEffect({
  words = DEFAULT_WORDS,
  width = 600,
  height = 240,
}: MobileParticleEffectProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const frameCountRef = useRef(0);
  const wordIndexRef = useRef(0);
  const mouseRef = useRef({ x: 0, y: 0, isPressed: false, isRightClick: false });

  const pixelSteps = 6;
  const drawAsPoints = true;

  useEffect(() => {
    if (Platform.OS !== 'web' || !canvasRef.current) return;

    const canvas = canvasRef.current;
    canvas.width = width;
    canvas.height = height;

    const generateRandomPos = (x: number, y: number, mag: number): Vector2D => {
      const randomX = Math.random() * 1000;
      const randomY = Math.random() * 500;
      const direction = { x: randomX - x, y: randomY - y };
      const magnitude = Math.sqrt(direction.x * direction.x + direction.y * direction.y);
      if (magnitude > 0) {
        direction.x = (direction.x / magnitude) * mag;
        direction.y = (direction.y / magnitude) * mag;
      }
      return { x: x + direction.x, y: y + direction.y };
    };

    const nextWord = (word: string) => {
      const offscreenCanvas = document.createElement('canvas');
      offscreenCanvas.width = canvas.width;
      offscreenCanvas.height = canvas.height;
      const offscreenCtx = offscreenCanvas.getContext('2d');
      if (!offscreenCtx) return;

      offscreenCtx.fillStyle = 'white';
      // Dynamically fit text inside canvas to avoid overflow
      let fontSize = Math.min(Math.floor(canvas.height * 0.42), Math.floor(canvas.width / 7));
      offscreenCtx.font = `bold ${fontSize}px Arial, -apple-system, sans-serif`;
      let textWidth = offscreenCtx.measureText(word).width;
      while (textWidth > canvas.width * 0.88 && fontSize > 20) {
        fontSize -= 3;
        offscreenCtx.font = `bold ${fontSize}px Arial, -apple-system, sans-serif`;
        textWidth = offscreenCtx.measureText(word).width;
      }
      offscreenCtx.textAlign = 'center';
      offscreenCtx.textBaseline = 'middle';
      offscreenCtx.fillText(word, canvas.width / 2, canvas.height / 2);

      const imageData = offscreenCtx.getImageData(0, 0, canvas.width, canvas.height);
      const pixels = imageData.data;

      const palette = [
        { r: 59, g: 130, b: 246 },   // Electric Blue
        { r: 56, g: 189, b: 248 },   // Sky Cyan
        { r: 99, g: 102, b: 241 },   // Indigo
        { r: 147, g: 197, b: 253 },  // Soft Blue
        { r: 255, g: 255, b: 255 },  // White
      ];
      const chosen = palette[Math.floor(Math.random() * palette.length)];
      const newColor = { r: chosen.r, g: chosen.g, b: chosen.b };

      const particles = particlesRef.current;
      let particleIndex = 0;

      const coordsIndexes: number[] = [];
      for (let i = 0; i < pixels.length; i += pixelSteps * 4) {
        coordsIndexes.push(i);
      }

      for (let i = coordsIndexes.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [coordsIndexes[i], coordsIndexes[j]] = [coordsIndexes[j], coordsIndexes[i]];
      }

      for (const coordIndex of coordsIndexes) {
        const pixelIndex = coordIndex;
        const alpha = pixels[pixelIndex + 3];

        if (alpha > 0) {
          const x = (pixelIndex / 4) % canvas.width;
          const y = Math.floor(pixelIndex / 4 / canvas.width);

          let particle: Particle;

          if (particleIndex < particles.length) {
            particle = particles[particleIndex];
            particle.isKilled = false;
            particleIndex++;
          } else {
            particle = new Particle();
            const randomPos = generateRandomPos(canvas.width / 2, canvas.height / 2, (canvas.width + canvas.height) / 2);
            particle.pos.x = randomPos.x;
            particle.pos.y = randomPos.y;
            particle.maxSpeed = Math.random() * 6 + 4;
            particle.maxForce = particle.maxSpeed * 0.05;
            particle.particleSize = Math.random() * 6 + 6;
            particle.colorBlendRate = Math.random() * 0.0275 + 0.0025;
            particles.push(particle);
          }

          particle.startColor = {
            r: particle.startColor.r + (particle.targetColor.r - particle.startColor.r) * particle.colorWeight,
            g: particle.startColor.g + (particle.targetColor.g - particle.startColor.g) * particle.colorWeight,
            b: particle.startColor.b + (particle.targetColor.b - particle.startColor.b) * particle.colorWeight,
          };
          particle.targetColor = newColor;
          particle.colorWeight = 0;
          particle.target.x = x;
          particle.target.y = y;
        }
      }

      for (let i = particleIndex; i < particles.length; i++) {
        particles[i].kill(canvas.width, canvas.height);
      }
    };

    const animate = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const particles = particlesRef.current;

      ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      for (let i = particles.length - 1; i >= 0; i--) {
        const particle = particles[i];
        particle.move();
        particle.draw(ctx, drawAsPoints);

        if (particle.isKilled) {
          if (
            particle.pos.x < 0 ||
            particle.pos.x > canvas.width ||
            particle.pos.y < 0 ||
            particle.pos.y > canvas.height
          ) {
            particles.splice(i, 1);
          }
        }
      }

      if (mouseRef.current.isPressed) {
        particles.forEach((particle) => {
          const distance = Math.sqrt(
            Math.pow(particle.pos.x - mouseRef.current.x, 2) + Math.pow(particle.pos.y - mouseRef.current.y, 2)
          );
          if (distance < 55) {
            particle.kill(canvas.width, canvas.height);
          }
        });
      }

      frameCountRef.current++;
      if (frameCountRef.current % 240 === 0) {
        wordIndexRef.current = (wordIndexRef.current + 1) % words.length;
        nextWord(words[wordIndexRef.current]);
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    nextWord(words[0]);
    animate();

    const handleMouseDown = (e: MouseEvent) => {
      mouseRef.current.isPressed = true;
      mouseRef.current.isRightClick = e.button === 2;
      const rect = canvas.getBoundingClientRect();
      mouseRef.current.x = e.clientX - rect.left;
      mouseRef.current.y = e.clientY - rect.top;
    };

    const handleMouseUp = () => {
      mouseRef.current.isPressed = false;
      mouseRef.current.isRightClick = false;
    };

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current.x = e.clientX - rect.left;
      mouseRef.current.y = e.clientY - rect.top;
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        mouseRef.current.isPressed = true;
        const rect = canvas.getBoundingClientRect();
        mouseRef.current.x = e.touches[0].clientX - rect.left;
        mouseRef.current.y = e.touches[0].clientY - rect.top;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        const rect = canvas.getBoundingClientRect();
        mouseRef.current.x = e.touches[0].clientX - rect.left;
        mouseRef.current.y = e.touches[0].clientY - rect.top;
      }
    };

    const handleTouchEnd = () => {
      mouseRef.current.isPressed = false;
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('touchstart', handleTouchStart, { passive: true });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: true });
    canvas.addEventListener('touchend', handleTouchEnd);
    canvas.addEventListener('contextmenu', handleContextMenu);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('touchstart', handleTouchStart);
      canvas.removeEventListener('touchmove', handleTouchMove);
      canvas.removeEventListener('touchend', handleTouchEnd);
      canvas.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [width, height, words]);

  if (Platform.OS === 'web') {
    return (
      <View style={s.wrap}>
        {React.createElement('canvas', {
          ref: canvasRef,
          style: {
            width: '100%',
            maxWidth: width,
            height: 'auto',
            aspectRatio: `${width}/${height}`,
            borderRadius: 18,
            border: '1px solid rgba(255, 255, 255, 0.12)',
            backgroundColor: 'rgba(0, 0, 0, 0.65)',
            boxShadow: '0 12px 36px rgba(0, 0, 0, 0.6)',
          },
        })}
        <Text style={s.sub}>Click & drag or right-click to disperse particles • Words cycle automatically</Text>
      </View>
    );
  }

  return (
    <View style={s.wrap}>
      <View style={s.nativeFallback}>
        <Text style={s.nativeText}>HOLBOX ATTENDANCE</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    width: '100%',
    alignItems: 'center',
    marginVertical: 14,
  },
  sub: {
    color: 'rgba(255, 255, 255, 0.45)',
    fontSize: 11,
    marginTop: 8,
    textAlign: 'center',
  },
  nativeFallback: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderWidth: 1,
  },
  nativeText: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
});

export default MobileParticleEffect;
