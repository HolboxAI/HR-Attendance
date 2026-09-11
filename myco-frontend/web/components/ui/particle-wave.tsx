"use client";

import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';

interface ParticleWaveProps {
  className?: string;
}

export const ParticleWave: React.FC<ParticleWaveProps> = ({ className = '' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    particles: THREE.Points;
    particleMaterial: THREE.ShaderMaterial;
    animationId: number | null;
    mouse: THREE.Vector2;
  } | null>(null);

  // Function to detect current theme
  const getCurrentTheme = () => {
    if (typeof document === 'undefined') return 'dark';
    return document.documentElement.classList.contains('bx-dark-mode') ||
      document.documentElement.classList.contains('dark')
      ? 'dark'
      : 'light';
  };

  // Function to get background color based on theme
  const getBackgroundColor = (theme: string) => {
    return theme === 'dark'
      ? new THREE.Color(0x09090b) // Dark ground color matching HRMS palette
      : new THREE.Color(0xf4f4f5); // Light ground color
  };

  // Function to get particle color based on theme
  const getParticleColor = (theme: string) => {
    return theme === 'dark'
      ? new THREE.Vector3(0.9, 0.9, 0.95) // Refined white/silver particles for dark theme
      : new THREE.Vector3(0.2, 0.2, 0.25); // Subtle slate particles for light theme
  };

  const particleVertex = `
    attribute float scale;
    uniform float uTime;
    void main() {
      vec3 p = position;
      float s = scale;
      p.y += (sin(p.x + uTime) * 0.5) + (cos(p.y + uTime) * 0.1) * 2.0;
      p.x += (sin(p.y + uTime) * 0.5);
      s += (sin(p.x + uTime) * 0.5) + (cos(p.y + uTime) * 0.1) * 2.0;
      vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
      gl_PointSize = s * 15.0 * (1.0 / -mvPosition.z);
      gl_Position = projectionMatrix * mvPosition;
    }
  `;

  const particleFragment = `
    uniform vec3 uColor;
    void main() {
      float d = length(gl_PointCoord - vec2(0.5));
      if (d > 0.5) discard;
      gl_FragColor = vec4(uColor, 0.35);
    }
  `;

  const initScene = () => {
    if (!canvasRef.current || typeof window === 'undefined') return;

    const canvas = canvasRef.current;
    const winWidth = window.innerWidth;
    const winHeight = window.innerHeight;
    const aspectRatio = winWidth / winHeight;

    // Camera
    const camera = new THREE.PerspectiveCamera(75, aspectRatio, 0.01, 1000);
    camera.position.set(0, 6, 5);

    // Scene
    const scene = new THREE.Scene();

    // Renderer
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
    });
    // Ambient decoration does not get retina pixels: at DPR 2 this canvas
    // pushes 4x the fragments for a blur-softened background nobody reads.
    renderer.setPixelRatio(1);
    renderer.setSize(winWidth, winHeight);

    // Set initial background color based on theme
    const currentTheme = getCurrentTheme();
    renderer.setClearColor(getBackgroundColor(currentTheme), 0);

    // Particles
    const gap = 0.9;
    const amountX = 45;
    const amountY = 45;
    const particleNum = amountX * amountY;
    const particlePositions = new Float32Array(particleNum * 3);
    const particleScales = new Float32Array(particleNum);

    let i = 0;
    let j = 0;
    for (let ix = 0; ix < amountX; ix++) {
      for (let iy = 0; iy < amountY; iy++) {
        particlePositions[i] = ix * gap - ((amountX * gap) / 2);
        particlePositions[i + 1] = 0;
        particlePositions[i + 2] = iy * gap - ((amountX * gap) / 2);
        particleScales[j] = 1;
        i += 3;
        j++;
      }
    }

    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    particleGeometry.setAttribute('scale', new THREE.BufferAttribute(particleScales, 1));

    const particleMaterial = new THREE.ShaderMaterial({
      transparent: true,
      vertexShader: particleVertex,
      fragmentShader: particleFragment,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: getParticleColor(getCurrentTheme()) },
      },
    });

    const particles = new THREE.Points(particleGeometry, particleMaterial);
    scene.add(particles);

    const mouse = new THREE.Vector2(-10, -10);

    sceneRef.current = {
      scene,
      camera,
      renderer,
      particles,
      particleMaterial,
      animationId: null,
      mouse,
    };
  };

  // The wave yields to the product. It renders at half rate, and it PAUSES
  // outright while the user scrolls and while the tab is hidden - a
  // full-viewport WebGL loop under blur(…) glass was the single biggest
  // reason scrolling felt heavy, because every animated frame forced the
  // glass panels above it to re-composite.
  const FRAME_MS = 1000 / 30;
  const lastFrame = { t: 0 };
  const paused = { scroll: 0, hidden: false };

  const animate = (now?: number) => {
    if (!sceneRef.current) return;
    sceneRef.current.animationId = requestAnimationFrame(animate);

    const t = now ?? performance.now();
    if (paused.hidden || t < paused.scroll) return;
    if (t - lastFrame.t < FRAME_MS) return;
    lastFrame.t = t;

    const { scene, camera, renderer, particleMaterial } = sceneRef.current;

    particleMaterial.uniforms.uTime.value += 0.07; // same speed at half rate

    const currentTheme = getCurrentTheme();
    particleMaterial.uniforms.uColor.value = getParticleColor(currentTheme);

    camera.lookAt(scene.position);
    renderer.render(scene, camera);
  };

  // Capture-phase, so the inner <main>'s scroll (which does not bubble)
  // still reaches us. 250ms of quiet after the last scroll event resumes.
  const onAnyScroll = () => { paused.scroll = performance.now() + 250; };
  const onVisibility = () => { paused.hidden = document.hidden; };

  const handleResize = () => {
    if (!sceneRef.current || typeof window === 'undefined') return;

    const { camera, renderer } = sceneRef.current;
    const winWidth = window.innerWidth;
    const winHeight = window.innerHeight;

    camera.aspect = winWidth / winHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(winWidth, winHeight);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!sceneRef.current || typeof window === 'undefined') return;

    sceneRef.current.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    sceneRef.current.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  };

  useEffect(() => {
    initScene();
    animate();

    const handleResizeEvent = () => handleResize();
    const handleMouseMoveEvent = (e: MouseEvent) => handleMouseMove(e);

    // Browsers cap live WebGL contexts (~8-16 per page) and reclaim the
    // oldest when the cap is hit - which dev hot-reload reaches quickly
    // with two canvases (this one + the login's dot matrix) remounting.
    // Without these handlers a reclaimed context logged "Context Lost" and
    // the background silently died until a full reload. preventDefault()
    // opts in to restoration; on restore, the render loop just resumes.
    const canvas = canvasRef.current;
    const onContextLost = (e: Event) => {
      e.preventDefault();
      paused.hidden = true;
    };
    const onContextRestored = () => {
      paused.hidden = document.hidden;
    };
    canvas?.addEventListener('webglcontextlost', onContextLost);
    canvas?.addEventListener('webglcontextrestored', onContextRestored);

    window.addEventListener('resize', handleResizeEvent);
    window.addEventListener('scroll', onAnyScroll, { capture: true, passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('mousemove', handleMouseMoveEvent);

    return () => {
      if (sceneRef.current?.animationId) {
        cancelAnimationFrame(sceneRef.current.animationId);
      }
      canvas?.removeEventListener('webglcontextlost', onContextLost);
      canvas?.removeEventListener('webglcontextrestored', onContextRestored);
      window.removeEventListener('resize', handleResizeEvent);
      window.removeEventListener('scroll', onAnyScroll, { capture: true } as EventListenerOptions);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('mousemove', handleMouseMoveEvent);

      // Cleanup Three.js resources
      if (sceneRef.current) {
        const { scene, renderer, particles } = sceneRef.current;
        scene.remove(particles);
        if (particles.geometry) particles.geometry.dispose();
        if (particles.material) {
          if (Array.isArray(particles.material)) {
            particles.material.forEach((material) => material.dispose());
          } else {
            particles.material.dispose();
          }
        }
        renderer.dispose();
        sceneRef.current = null;
        // dispose() frees GL objects but leaves the CONTEXT alive until GC;
        // under hot-reload those zombie contexts are what pushed the page
        // over the browser's cap. Hand it back deliberately - but ONLY if
        // the canvas is really leaving the DOM. React StrictMode runs
        // effect -> cleanup -> effect on the SAME canvas, and force-losing
        // its context in between hands the second initScene a dead context
        // ("Cannot read properties of null (reading 'precision')"). Defer
        // one tick: a StrictMode replay keeps the canvas connected and
        // skips this; a true unmount has removed it.
        setTimeout(() => {
          if (canvas && !canvas.isConnected) renderer.forceContextLoss();
        }, 0);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={`block pointer-events-none ${className}`}
      style={{
        width: '100vw',
        height: '100vh',
        margin: 0,
        overflow: 'hidden',
      }}
    />
  );
};

export default ParticleWave;
