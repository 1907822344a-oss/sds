
import * as THREE from 'three';

export interface SceneState {
    mode: 'TREE' | 'SCATTER' | 'LETTER' | 'FOCUS';
    focusTarget: THREE.Object3D | null;
    currentPhotoIndex: number;
    currentThemeIndex: number;
    gestureDebounceTimer: number;
    scatterScale: number;
    gestureBaseSpread: number | null;
    hand: { detected: boolean; x: number; y: number };
    rotation: { x: number; y: number };
    spinVel: { x: number; y: number };
    time: number;
    wasPointing: boolean;
    palmCenter: { x: number; y: number };
    hasPalmCenter: boolean;
    starMesh: THREE.Mesh | null;
    starHaloMesh: THREE.Mesh | null;
    letterContent: string;
    letterTyper: any | null;
    letterStartTimer: any | null;
    letterLastTriggerTime: number;
    musicData: string | null;
}

export const CONFIG = {
    colors: {
        bg: 0x020205, gold: 0xffd700, red: 0x880000, green: 0x004400,
        iceBlue: 0xaaddff, white: 0xffffff 
    },
    particles: { 
        count: 1800, dustCount: 1500, treeHeight: 28, treeRadius: 9,
        snowCount: 2000, snowSpeed: 8 
    },
    camera: { z: 55 },
    gestures: { palmOpenThreshold: 0.35, sensitivity: 6.0 }
};
