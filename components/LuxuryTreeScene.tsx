
import React, { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { FilesetResolver, HandLandmarker, DrawingUtils } from '@mediapipe/tasks-vision';
import { CONFIG, SceneState } from '../types';

interface LuxuryTreeSceneProps {
  letterContent: string;
  onLetterTrigger: () => void;
}

const LuxuryTreeScene = forwardRef((props: LuxuryTreeSceneProps, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<SceneState>({
    mode: 'TREE', focusTarget: null, currentPhotoIndex: -1,
    currentThemeIndex: 0,
    gestureDebounceTimer: 0,
    scatterScale: 1.0, gestureBaseSpread: null,
    hand: { detected: false, x: 0, y: 0 },
    rotation: { x: 0, y: 0 }, spinVel: { x: 0, y: 0 }, time: 0,
    wasPointing: false, palmCenter: { x: 0.5, y: 0.5 }, hasPalmCenter: false,
    starMesh: null, starHaloMesh: null,
    letterContent: props.letterContent,
    letterTyper: null, letterStartTimer: null, letterLastTriggerTime: 0,
    musicData: null
  });

  const engineRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    composer: EffectComposer;
    clock: THREE.Clock;
    mainGroup: THREE.Group;
    bgGroup: THREE.Group;
    photoMeshGroup: THREE.Group;
    particleSystem: any[];
    galaxySystem: THREE.Points | null;
    snowSystem: THREE.Points | null;
    constellationSystem: THREE.Group | null;
    handLandmarker: HandLandmarker | null;
    video: HTMLVideoElement | null;
    drawingUtils: DrawingUtils | null;
    canvasCtx: CanvasRenderingContext2D | null;
    matLib: Record<string, THREE.Material>;
    caneTexture: THREE.Texture | null;
    snowTexture: THREE.Texture | null;
  } | null>(null);

  useImperativeHandle(ref, () => ({
    handleImageUpload: (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files) return;
      Array.from(e.target.files).forEach(f => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          new THREE.TextureLoader().load(ev.target?.result as string, t => {
            t.colorSpace = THREE.SRGBColorSpace;
            addPhotoToScene(t);
          });
        };
        reader.readAsDataURL(f as unknown as Blob);
      });
    },
    setMusicData: (data: string) => {
      stateRef.current.musicData = data;
    },
    exitLetterMode: () => {
      stateRef.current.mode = 'TREE';
      stateRef.current.spinVel = { x: 0, y: 0 };
    },
    exportSceneData: () => {
      const photos = engineRef.current!.particleSystem.filter(p => p.type === 'PHOTO').map(p => {
        try { return p.mesh.children[1].material.map.image.src; } catch (e) { return null; }
      }).filter(src => src !== null);

      const exportData = {
        music: stateRef.current.musicData,
        letter: stateRef.current.letterContent,
        photos: photos,
        theme: stateRef.current.currentThemeIndex
      };

      const blob = new Blob([JSON.stringify(exportData)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = "tree_config.json";
      a.click();
      URL.revokeObjectURL(url);
    },
    importSceneData: (jsonData: string) => {
      try {
        const data = JSON.parse(jsonData);
        if (data.letter) stateRef.current.letterContent = data.letter;
        if (data.music) {
            stateRef.current.musicData = data.music;
            const audioEl = document.getElementById('bg-music') as HTMLAudioElement;
            if (audioEl) {
                audioEl.src = data.music;
                audioEl.play().catch(console.warn);
            }
        }
        clearPhotos();
        if (data.photos && Array.isArray(data.photos)) {
            const loader = new THREE.TextureLoader();
            data.photos.forEach((src: string) => {
                loader.load(src, t => { 
                    t.colorSpace = THREE.SRGBColorSpace; 
                    addPhotoToScene(t); 
                });
            });
        }
        if (data.theme !== undefined) switchTheme(data.theme);
        return data;
      } catch (e) {
        console.error("Import failed:", e);
      }
    },
    initCamera: async () => {
        const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm");
        engineRef.current!.handLandmarker = await HandLandmarker.createFromOptions(vision, { 
            baseOptions: { 
                modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`, 
                delegate: "GPU" 
            }, 
            runningMode: "VIDEO", 
            numHands: 1 
        });
        
        const video = document.getElementById('webcam') as HTMLVideoElement;
        const canvas = document.getElementById('webcam-preview') as HTMLCanvasElement;
        const ctx = canvas.getContext('2d');
        engineRef.current!.video = video;
        engineRef.current!.canvasCtx = ctx;
        engineRef.current!.drawingUtils = new DrawingUtils(ctx!);
        
        if (navigator.mediaDevices?.getUserMedia) {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
            video.srcObject = stream;
            video.onloadeddata = () => {
                video.play();
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                predictWebcam();
            };
        }
    }
  }));

  const clearPhotos = () => {
    const photosToRemove = engineRef.current!.particleSystem.filter(p => p.type === 'PHOTO');
    photosToRemove.forEach(p => {
        engineRef.current!.photoMeshGroup.remove(p.mesh);
    });
    engineRef.current!.particleSystem = engineRef.current!.particleSystem.filter(p => p.type !== 'PHOTO');
  };

  const switchTheme = (themeIndex: number) => {
    stateRef.current.currentThemeIndex = themeIndex;
    const isGold = (themeIndex === 0);
    engineRef.current!.renderer.toneMappingExposure = isGold ? 1.0 : 0.6;
    if (engineRef.current!.galaxySystem) engineRef.current!.galaxySystem.visible = isGold;
    if (engineRef.current!.snowSystem) engineRef.current!.snowSystem.visible = !isGold;
    if (engineRef.current!.constellationSystem) engineRef.current!.constellationSystem.visible = isGold;

    engineRef.current!.particleSystem.forEach(p => {
        if (p.isDust) return;
        if (p.type === 'PHOTO') {
            const group = p.mesh;
            if (group.children[0]) group.children[0].material = isGold ? engineRef.current!.matLib.frameGold : engineRef.current!.matLib.ice;
            if (group.children[2]) group.children[2].visible = !isGold;
            return;
        }
        let newMat;
        const lib = engineRef.current!.matLib;
        if (isGold) {
            if(p.type.includes('GOLD')) newMat = lib.gold;
            else if(p.type === 'BOX') newMat = lib.green;
            else if(p.type === 'RED') newMat = lib.red;
            else if(p.type === 'CANE') newMat = lib.candy;
        } else {
            if(p.type.includes('GOLD') || p.type === 'BOX') newMat = lib.ice; 
            else if(p.type === 'RED') newMat = lib.snow;  
            else if(p.type === 'CANE') newMat = lib.ice; 
        }
        if (newMat) p.mesh.material = newMat;
    });

    if (stateRef.current.starMesh && stateRef.current.starHaloMesh) {
        stateRef.current.starMesh.material = isGold ? engineRef.current!.matLib.starGold : engineRef.current!.matLib.starIce;
        (stateRef.current.starHaloMesh.material as THREE.MeshBasicMaterial).color.setHex(isGold ? 0xffaa00 : CONFIG.colors.iceBlue);
    }
  };

  const addPhotoToScene = (texture: THREE.Texture) => {
    if (!texture.image) return;
    const aspect = texture.image.width / texture.image.height;
    let photoW = (aspect >= 1) ? 1.2 : 1.2 * aspect, photoH = (aspect >= 1) ? 1.2 / aspect : 1.2;
    
    const group = new THREE.Group();
    const frameGeo = new THREE.BoxGeometry(photoW + 0.15, photoH + 0.15, 0.1);
    const lib = engineRef.current!.matLib;
    const currentFrameMat = (stateRef.current.currentThemeIndex === 0) ? lib.frameGold : lib.ice;
    const frame = new THREE.Mesh(frameGeo, currentFrameMat);
    group.add(frame);
    
    const photo = new THREE.Mesh(new THREE.PlaneGeometry(photoW, photoH), new THREE.MeshBasicMaterial({ map: texture }));
    photo.position.z = 0.06; group.add(photo);

    const borderGeo = new THREE.BoxGeometry(photoW + 0.25, photoH + 0.25, 0.08);
    const border = new THREE.Mesh(borderGeo, lib.snowBorder);
    border.position.z = -0.02; border.visible = (stateRef.current.currentThemeIndex !== 0);
    group.add(border);

    engineRef.current!.photoMeshGroup.add(group);
    engineRef.current!.particleSystem.push(new Particle(group, 'PHOTO', false));
  };

  let lastVideoTime = -1;
  const predictWebcam = async () => {
    const video = engineRef.current?.video;
    const landmarker = engineRef.current?.handLandmarker;
    if (video && landmarker && lastVideoTime !== video.currentTime) {
        lastVideoTime = video.currentTime;
        const result = landmarker.detectForVideo(video, performance.now());
        const ctx = engineRef.current!.canvasCtx;
        if (ctx) {
            ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            ctx.drawImage(video, 0, 0, ctx.canvas.width, ctx.canvas.height);
            if (result.landmarks?.[0]) {
                engineRef.current!.drawingUtils!.drawConnectors(result.landmarks[0], HandLandmarker.HAND_CONNECTIONS, { color: "#d4af37", lineWidth: 3 });
                engineRef.current!.drawingUtils!.drawLandmarks(result.landmarks[0], { color: "#ffffff", lineWidth: 1, radius: 3 });
                processGestures(result.landmarks[0]);
            } else stateRef.current.hand.detected = false;
        }
    }
    requestAnimationFrame(predictWebcam);
  };

  const processGestures = (lm: any[]) => {
    stateRef.current.hand.detected = true;
    if (stateRef.current.mode === 'LETTER') return;

    const dist = (i: number, j: number) => Math.hypot(lm[i].x - lm[j].x, lm[i].y - lm[j].y);
    const dIndex = dist(8, 0), dMiddle = dist(12, 0), dRing = dist(16, 0), dPinky = dist(20, 0);
    const palmSize = dist(0, 9);

    if (dist(4, 8) < 0.05 && dMiddle > 0.15 && dMiddle > dIndex * 1.2) {
        if (Date.now() - stateRef.current.letterLastTriggerTime > 1000) {
            stateRef.current.letterLastTriggerTime = Date.now();
            stateRef.current.mode = 'LETTER';
            props.onLetterTrigger();
        }
        return;
    }

    const isVHigh = dIndex > palmSize * 1.3 && dMiddle > palmSize * 1.3;
    const isOthersLow = dRing < dIndex * 0.5 && dPinky < dMiddle * 0.5;
    const isSpread = dist(8, 12) > dist(5, 9) * 1.2;

    if (isVHigh && isOthersLow && isSpread) {
        if (Date.now() - stateRef.current.gestureDebounceTimer > 2000) {
            switchTheme((stateRef.current.currentThemeIndex + 1) % 2);
            stateRef.current.gestureDebounceTimer = Date.now();
        }
    }

    const isPointing = dIndex > 0.1 && dMiddle < dIndex * 0.7 && dRing < dIndex * 0.7;
    const avgSpread = (dIndex + dMiddle + dRing + dPinky) / 4, isPalmOpen = avgSpread > CONFIG.gestures.palmOpenThreshold;

    if (isPointing) {
        stateRef.current.mode = 'FOCUS';
        if (!stateRef.current.wasPointing) {
            const photos = engineRef.current!.particleSystem.filter(p => p.type === 'PHOTO');
            stateRef.current.focusTarget = photos.length ? photos[(++stateRef.current.currentPhotoIndex) % photos.length].mesh : stateRef.current.starMesh;
        }
        stateRef.current.wasPointing = true; stateRef.current.hasPalmCenter = false;
        stateRef.current.spinVel.x *= 0.9; stateRef.current.spinVel.y *= 0.9;
    } else {
        stateRef.current.wasPointing = false;
        if (isPalmOpen) {
            if (stateRef.current.mode !== 'SCATTER' || !stateRef.current.hasPalmCenter) {
                stateRef.current.palmCenter = { x: lm[9].x, y: lm[9].y }; 
                stateRef.current.hasPalmCenter = true; 
                stateRef.current.gestureBaseSpread = avgSpread; 
                stateRef.current.scatterScale = 1.0;
            }
            stateRef.current.mode = 'SCATTER';
            if (stateRef.current.gestureBaseSpread) {
                stateRef.current.scatterScale += (THREE.MathUtils.clamp(Math.pow(stateRef.current.gestureBaseSpread / avgSpread, 2), 0.1, 5.0) - stateRef.current.scatterScale) * 0.15;
            }
            const gain = CONFIG.gestures.sensitivity, dx = lm[9].x - stateRef.current.palmCenter.x, dy = lm[9].y - stateRef.current.palmCenter.y;
            stateRef.current.spinVel.x += (THREE.MathUtils.clamp(-dy * gain, -3, 3) - stateRef.current.spinVel.x) * 0.2;
            stateRef.current.spinVel.y += (THREE.MathUtils.clamp(dx * gain, -3, 3) - stateRef.current.spinVel.y) * 0.2;
        } else {
            stateRef.current.mode = 'TREE'; stateRef.current.hasPalmCenter = false; stateRef.current.scatterScale = 1.0;
            stateRef.current.spinVel.x *= 0.9; stateRef.current.spinVel.y *= 0.9;
        }
    }

    if (stateRef.current.mode !== 'FOCUS') {
        stateRef.current.hand.x += ((lm[9].x - 0.5) * 3.0 - stateRef.current.hand.x) * 0.1;
        stateRef.current.hand.y += ((lm[9].y - 0.5) * 3.0 - stateRef.current.hand.y) * 0.1;
    }
  };

  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(CONFIG.colors.bg);
    scene.fog = new THREE.FogExp2(CONFIG.colors.bg, 0.012);

    const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 2000);
    camera.position.set(0, 0, CONFIG.camera.z);

    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance", depth: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    containerRef.current.appendChild(renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    const bgGroup = new THREE.Group(); scene.add(bgGroup);
    const mainGroup = new THREE.Group(); mainGroup.rotation.x = 0.1; scene.add(mainGroup);
    const starGroup = new THREE.Group(); mainGroup.add(starGroup);
    const photoMeshGroup = new THREE.Group(); mainGroup.add(photoMeshGroup);

    scene.add(new THREE.AmbientLight(0xffffff, 0.2));
    const bottomLight = new THREE.PointLight(CONFIG.colors.gold, 3, 40);
    bottomLight.position.set(0, -10, 10);
    mainGroup.add(bottomLight);

    const matLib: Record<string, THREE.Material> = {};
    const createMaterials = () => {
        const snowCvs = document.createElement('canvas'); snowCvs.width = 32; snowCvs.height = 32;
        const sCtx = snowCvs.getContext('2d')!;
        const grad = sCtx.createRadialGradient(16,16,0, 16,16,16);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        sCtx.fillStyle = grad; sCtx.fillRect(0,0,32,32);
        const snowTex = new THREE.CanvasTexture(snowCvs);

        matLib.gold = new THREE.MeshStandardMaterial({ color: CONFIG.colors.gold, metalness: 1.0, roughness: 0.15, envMapIntensity: 2.5, emissive: 0x664400, emissiveIntensity: 0.2 });
        matLib.green = new THREE.MeshStandardMaterial({ color: CONFIG.colors.green, metalness: 0.4, roughness: 0.3, emissive: 0x001100, emissiveIntensity: 0.1 });
        matLib.red = new THREE.MeshPhysicalMaterial({ color: CONFIG.colors.red, metalness: 0.6, roughness: 0.2, clearcoat: 1.0, emissive: 0x330000, emissiveIntensity: 0.4 });
        matLib.starGold = new THREE.MeshStandardMaterial({ color: 0xffdd88, emissive: 0xffaa00, emissiveIntensity: 2.0, metalness: 1.0, roughness: 0 });
        matLib.frameGold = new THREE.MeshStandardMaterial({ color: CONFIG.colors.gold, metalness: 1.0, roughness: 0.2 });
        matLib.snowBorder = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, side: THREE.BackSide });
        matLib.snowFlake = new THREE.PointsMaterial({ color: 0xffffff, size: 0.6, map: snowTex, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
        matLib.dust = new THREE.MeshBasicMaterial({ color: 0xffffee, blending: THREE.AdditiveBlending });
        matLib.ice = new THREE.MeshPhysicalMaterial({ color: CONFIG.colors.iceBlue, metalness: 0.1, roughness: 0.1, transmission: 0.9, thickness: 2.5, ior: 1.5, clearcoat: 1.0, emissive: 0x001133, emissiveIntensity: 0.2 });
        matLib.starIce = new THREE.MeshPhysicalMaterial({ color: CONFIG.colors.iceBlue, emissive: CONFIG.colors.iceBlue, emissiveIntensity: 1.2, metalness: 0.5, roughness: 0.1, transmission: 0.8, thickness: 2.0, clearcoat: 1.0 });
        matLib.snow = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.0, roughness: 0.9, emissive: 0xaaaaaa, emissiveIntensity: 0.3 });
    };
    createMaterials();

    const particleSystemArr: any[] = [];
    const createParticles = () => {
        const sphereGeo = new THREE.SphereGeometry(0.5, 16, 16), boxGeo = new THREE.BoxGeometry(0.45, 0.45, 0.45);
        const dustGeo = new THREE.OctahedronGeometry(0.1, 0);
        for (let i = 0; i < CONFIG.particles.count; i++) {
            const rand = Math.random(); let mesh, type;
            if (rand < 0.4) { mesh = new THREE.Mesh(boxGeo, matLib.green); type = 'BOX'; } 
            else if (rand < 0.8) { mesh = new THREE.Mesh(boxGeo, matLib.gold); type = 'GOLD_BOX'; } 
            else { mesh = new THREE.Mesh(sphereGeo, matLib.red); type = 'RED'; }
            mesh.scale.setScalar(0.4 + Math.random() * 0.4);
            mesh.rotation.set(Math.random()*6, Math.random()*6, Math.random()*6);
            mainGroup.add(mesh); particleSystemArr.push(new Particle(mesh, type, false));
        }
        for(let i=0; i<CONFIG.particles.dustCount; i++) {
            const mesh = new THREE.Mesh(dustGeo, matLib.dust); mesh.scale.setScalar(0.5 + Math.random());
            mainGroup.add(mesh); particleSystemArr.push(new Particle(mesh, 'DUST', true));
        }
        const star = new THREE.Mesh(new THREE.OctahedronGeometry(1.5, 0), matLib.starGold);
        star.position.set(0, CONFIG.particles.treeHeight/2 + 1.2, 0);
        const halo = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshBasicMaterial({ 
            map: new THREE.TextureLoader().load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/sprites/glow.png'), 
            blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5, color: 0xffaa00 
        }));
        star.add(halo); starGroup.add(star);
        stateRef.current.starMesh = star; stateRef.current.starHaloMesh = halo;
    };
    createParticles();

    // --- High-Fidelity Sparse Constellations ---
    const createConstellations = () => {
        const group = new THREE.Group();
        
        // Dino Constellation (Stylized Image 2)
        const dinoPoints = [
          [0.0, 1.2], [0.3, 0.8], [0.5, 0.4], [0.4, -0.1], [0.1, -0.4], [-0.3, -0.3], [-0.5, 0.2], [-0.3, 0.7], // Hood Outline
          [0.1, 1.3], [0.0, 1.6], [-0.1, 1.3], // Pointy Top
          [0.5, -0.2], [0.75, -0.4], [0.85, -0.8], [0.6, -1.0], [0.3, -0.7], // Tail
          [-0.2, -0.5], [-0.4, -0.9], [0.2, -0.9], [0.3, -0.5], // Sturdy legs
          [-0.1, 0.2], [0.1, 0.2], [0.0, 0.0] // Face markers
        ];
        const dinoLines = [
          [0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,0], // Head Loop
          [0,8],[8,9],[9,10],[10,0], // Pointy Horn
          [3,11],[11,12],[12,13],[13,14],[14,15],[15,4], // Tail connection
          [5,16],[16,17],[18,19],[19,4], // Leg connections
          [20,22],[21,22] // Face V
        ];

        // Bubble Constellation
        const bubblePoints = [
          [0.0, 0.6], [0.4, 0.4], [0.5, -0.1], [0.3, -0.5], [-0.3, -0.5], [-0.5, -0.1], [-0.4, 0.4], // Head
          [-0.1, -0.6], [-0.2, -1.0], [0.2, -1.0], [0.1, -0.6], // Body
          [-0.6, 0.1], [-0.9, 0.3], [-1.0, 0.7], [-0.7, 0.8], [-0.5, 0.5], // The Bubble
          [-0.4, -0.4], [-0.7, -0.2], [-0.8, 0.1] // Arm leading to bubble
        ];
        const bubbleLines = [
          [0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,0], // Head
          [7,8],[8,9],[9,10],[10,7], // Torso
          [11,12],[12,13],[13,14],[14,15],[15,11], // Bubble
          [16,17],[17,18],[18,11] // Arm to bubble
        ];

        // Balloon Constellation
        const balloonPoints = [
          [0.0, 0.6], [0.35, 0.4], [0.4, -0.1], [-0.4, -0.1], [-0.35, 0.4], // Head
          [0.0, -0.1], [0.15, -0.5], [0.0, -1.0], [-0.15, -0.5], // Body
          [0.4, 0.0], [0.6, 0.3], [0.5, 0.7], [0.7, 1.1], [0.5, 1.4], // String
          [0.5, 1.6], [0.9, 1.8], [0.7, 2.3], [0.3, 2.1], [0.1, 1.8], [0.5, 1.6] // Star Balloon
        ];
        const balloonLines = [
          [0,1],[1,2],[2,3],[3,4],[4,0], // Head
          [5,6],[6,7],[7,8],[8,5], // Body
          [9,10],[10,11],[11,12],[12,13],[13,14], // Wavy String
          [14,15],[15,16],[16,17],[17,18],[18,19],[19,14] // Star
        ];

        const generateConstellation = (points: number[][], lines: number[][], center: THREE.Vector3, scale: number) => {
            const charGroup = new THREE.Group();
            const starGeo = new THREE.BufferGeometry();
            const positions = new Float32Array(points.length * 3);
            const sizes = new Float32Array(points.length);
            const phases = new Float32Array(points.length);

            points.forEach((p, i) => {
                positions[i*3] = p[0] * scale;
                positions[i*3+1] = p[1] * scale;
                positions[i*3+2] = (Math.random() - 0.5) * 1.5;
                sizes[i] = 2.0 + Math.random() * 4.0; // Larger stars at vertices
                phases[i] = Math.random() * Math.PI * 2;
            });

            starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            starGeo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
            starGeo.setAttribute('phase', new THREE.BufferAttribute(phases, 1));

            const starMat = new THREE.ShaderMaterial({
                uniforms: { time: { value: 0 } },
                vertexShader: `
                    attribute float size; attribute float phase;
                    varying float vOpacity; uniform float time;
                    void main() {
                        vOpacity = 0.5 + 0.5 * sin(time * 2.0 + phase);
                        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                        gl_PointSize = size * (350.0 / -mvPosition.z);
                        gl_Position = projectionMatrix * mvPosition;
                    }
                `,
                fragmentShader: `
                    varying float vOpacity;
                    void main() {
                        float dist = distance(gl_PointCoord, vec2(0.5));
                        if(dist > 0.5) discard;
                        // Sharp core for the star
                        float glow = pow(1.0 - dist * 2.0, 2.0);
                        gl_FragColor = vec4(1.0, 1.0, 1.0, vOpacity * glow);
                    }
                `,
                transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
            });
            const stars = new THREE.Points(starGeo, starMat);
            charGroup.add(stars);

            // connector lines
            const lineGeo = new THREE.BufferGeometry();
            const linePositions = new Float32Array(lines.length * 2 * 3);
            lines.forEach((l, i) => {
                const p1 = points[l[0]]; const p2 = points[l[1]];
                linePositions[i*6] = p1[0] * scale; linePositions[i*6+1] = p1[1] * scale; linePositions[i*6+2] = 0;
                linePositions[i*6+3] = p2[0] * scale; linePositions[i*6+4] = p2[1] * scale; linePositions[i*6+5] = 0;
            });
            lineGeo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
            const lineMat = new THREE.LineBasicMaterial({ 
                color: 0xffffff, transparent: true, opacity: 0.12, 
                blending: THREE.AdditiveBlending, linewidth: 1 
            });
            const connectorLines = new THREE.LineSegments(lineGeo, lineMat);
            charGroup.add(connectorLines);

            charGroup.position.copy(center);
            return charGroup;
        };

        // Spaced out in the black background
        const dinoC = generateConstellation(dinoPoints, dinoLines, new THREE.Vector3(75, 45, -145), 20);
        const bubbleC = generateConstellation(bubblePoints, bubbleLines, new THREE.Vector3(-85, 40, -155), 18);
        const balloonC = generateConstellation(balloonPoints, balloonLines, new THREE.Vector3(25, 95, -190), 16);
        
        group.add(dinoC, bubbleC, balloonC);
        bgGroup.add(group);
        return group;
    };
    const constellationSystem = createConstellations();

    const galaxyGeo = new THREE.BufferGeometry(), count = 3000;
    const pos = new Float32Array(count * 3), colors = new Float32Array(count * 3);
    for(let i=0; i<count; i++) {
        const r = 60 + Math.random()*250, theta = Math.random()*Math.PI*2, phi = Math.acos(2*Math.random()-1);
        pos[i*3] = r*Math.sin(phi)*Math.cos(theta); pos[i*3+1] = r*Math.sin(phi)*Math.sin(theta); pos[i*3+2] = r*Math.cos(phi);
        colors[i*3]=1; colors[i*3+1]=0.8; colors[i*3+2]=0.6;
    }
    galaxyGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    galaxyGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const galaxySystem = new THREE.Points(galaxyGeo, new THREE.PointsMaterial({ size: 1.0, transparent: true, opacity: 0.8, vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    bgGroup.add(galaxySystem);

    const snowGeo = new THREE.BufferGeometry();
    const snowCount = CONFIG.particles.snowCount;
    const snowPos = new Float32Array(snowCount * 3);
    const snowVels = new Float32Array(snowCount);
    for(let i=0; i<snowCount; i++) {
        snowPos[i*3] = (Math.random()-0.5)*100; snowPos[i*3+1] = (Math.random()-0.5)*100; snowPos[i*3+2] = (Math.random()-0.5)*60;
        snowVels[i] = 1.0 + Math.random();
    }
    snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
    snowGeo.setAttribute('velocity', new THREE.BufferAttribute(snowVels, 1));
    const snowSystem = new THREE.Points(snowGeo, matLib.snowFlake);
    snowSystem.visible = false; bgGroup.add(snowSystem);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
    bloom.threshold = 0.75; bloom.strength = 0.5; bloom.radius = 0.5;
    composer.addPass(bloom);

    const clock = new THREE.Clock();
    engineRef.current = {
        scene, camera, renderer, composer, clock, mainGroup, bgGroup, photoMeshGroup,
        particleSystem: particleSystemArr, galaxySystem, snowSystem, constellationSystem,
        handLandmarker: null, video: null, drawingUtils: null, canvasCtx: null,
        matLib, caneTexture: null, snowTexture: null
    };

    const animate = () => {
        const reqId = requestAnimationFrame(animate);
        const dt = clock.getDelta(); 
        const state = stateRef.current;
        state.time = clock.elapsedTime;
        
        if (state.mode === 'LETTER') {
            state.rotation.x = THREE.MathUtils.lerp(state.rotation.x, Math.PI/4, dt * 1.5);
            state.rotation.y -= 0.1 * dt;
        } else if (state.mode === 'TREE') {
            state.rotation.y -= 0.4 * dt; state.rotation.x = THREE.MathUtils.lerp(state.rotation.x, 0.15, dt * 2.0);
            mainGroup.rotation.z = THREE.MathUtils.lerp(mainGroup.rotation.z, state.hand.x * 0.1, dt * 2);
        } else if (state.mode === 'SCATTER') {
            state.rotation.y += state.spinVel.y * dt; state.rotation.x += state.spinVel.x * dt;
            if (!state.hand.detected) { state.spinVel.x *= 0.95; state.spinVel.y *= 0.95; }
        }

        mainGroup.rotation.y = state.rotation.y; mainGroup.rotation.x = state.rotation.x;
        
        if (galaxySystem.visible) bgGroup.rotation.y -= 0.05 * dt;
        
        // Update twinkling effect for all constellations
        if (constellationSystem) {
            constellationSystem.children.forEach((group: any) => {
                const starPoints = group.children[0];
                if (starPoints && starPoints.material?.uniforms) {
                    starPoints.material.uniforms.time.value = state.time;
                }
            });
        }

        if (snowSystem.visible) {
            const posAttr = snowSystem.geometry.attributes.position as THREE.BufferAttribute;
            const velAttr = snowSystem.geometry.attributes.velocity as THREE.BufferAttribute;
            for(let i=0; i<snowCount; i++) {
                posAttr.array[i*3+1] -= CONFIG.particles.snowSpeed * velAttr.array[i] * dt;
                if (posAttr.array[i*3+1] < -50) posAttr.array[i*3+1] = 50;
            }
            posAttr.needsUpdate = true;
            bgGroup.rotation.y -= 0.02 * dt;
        }

        if (state.starMesh) {
            state.starMesh.rotation.y -= dt; 
            state.starMesh.scale.setScalar(1.0 + Math.sin(state.time * 2) * 0.1);
        }

        const invMatrix = new THREE.Matrix4().copy(mainGroup.matrixWorld).invert();
        particleSystemArr.forEach(p => p.update(dt, state.time, state.mode, state.focusTarget, (state.mode === 'FOCUS' ? invMatrix : null), camera));
        
        composer.render();
    };
    animate();

    const handleResize = () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        composer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
        window.removeEventListener('resize', handleResize);
        containerRef.current?.removeChild(renderer.domElement);
        renderer.dispose();
    };
  }, []);

  return <div ref={containerRef} className="absolute inset-0 z-0 overflow-hidden" />;
});

const _tempVec = new THREE.Vector3();
const _targetVec = new THREE.Vector3();

class Particle {
  mesh: THREE.Object3D; type: string; isDust: boolean;
  posTree = new THREE.Vector3(); posScatter = new THREE.Vector3();
  baseScale: number; offset: number; speed: number;
  hasEmissive = false;

  constructor(mesh: THREE.Object3D, type: string, isDust = false) {
    this.mesh = mesh; this.type = type; this.isDust = isDust;
    this.baseScale = mesh.scale.x; this.offset = Math.random() * 100; this.speed = 0.5 + Math.random();
    const mat = (this.mesh as THREE.Mesh).material as any;
    if (mat && mat.emissive) this.hasEmissive = true;
    this.calculatePositions();
  }

  calculatePositions() {
    const h = CONFIG.particles.treeHeight; let t = Math.random();
    if (Math.random() > 0.7 && !this.isDust && this.type !== 'PHOTO') {
        const y = (t * h) - h/2, angle = t * Math.PI * 12, rBase = CONFIG.particles.treeRadius * (1.0 - t);
        this.posTree.set(Math.cos(angle) * rBase, y, Math.sin(angle) * rBase);
    } else {
        t = Math.pow(t, 0.8); const y = (t * h) - h/2, angle = Math.random() * Math.PI * 2, r = Math.max(0.5, CONFIG.particles.treeRadius * (1.0 - t)) * Math.sqrt(Math.random());
        this.posTree.set(Math.cos(angle) * r, y, Math.sin(angle) * r);
    }
    const rScatter = this.isDust ? (15 + Math.random()*25) : (10 + Math.random()*15);
    const theta = Math.random() * Math.PI * 2, phi = Math.acos(2 * Math.random() - 1);
    this.posScatter.set(rScatter * Math.sin(phi) * Math.cos(theta), rScatter * Math.sin(phi) * Math.sin(theta), rScatter * Math.cos(phi));
  }

  update(dt: number, time: number, mode: string, focusTargetMesh: any, invMatrix: any, camera: any) {
    let target, s = this.baseScale, lerpSpeed = 3.0;
    if (mode === 'SCATTER' || mode === 'LETTER') target = this.posScatter;
    else if (mode === 'FOCUS') {
        if (this.mesh === focusTargetMesh && invMatrix) {
            _targetVec.set(0, 0, CONFIG.camera.z - 15).applyMatrix4(invMatrix);
            target = _targetVec; lerpSpeed = 6.0; this.mesh.lookAt(camera.position); s = this.baseScale * 5.0;
        } else { target = this.posScatter; s = 0.01; }
    } else target = this.posTree;

    _tempVec.copy(target);
    if(mode === 'TREE') { 
        _tempVec.y += Math.sin(time * this.speed + this.offset) * 0.15; 
        _tempVec.x += Math.cos(time * 0.5 * this.speed + this.offset) * 0.1; 
    }
    this.mesh.position.lerp(_tempVec, lerpSpeed * dt);

    if (this.hasEmissive && mode === 'TREE' && !this.isDust) {
        const mat = (this.mesh as THREE.Mesh).material as any;
        const blink = Math.sin(time * 2 + this.offset);
        mat.emissiveIntensity = blink > 0.5 ? (1.0 + (blink - 0.5) * 2.5) : 0.4;
    }
    if (mode !== 'FOCUS') {
        if (this.isDust) s = this.baseScale * (0.5 + 0.5 * Math.sin(time * 3 + this.offset));
        else if (this.type === 'PHOTO') s = this.baseScale * 2.5;
    }
    this.mesh.scale.lerp(_tempVec.set(s,s,s), 5*dt);
  }
}

export default LuxuryTreeScene;
