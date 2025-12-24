
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Camera, Music, Image as ImageIcon, FileText, Globe, Download, Maximize, X } from 'lucide-react';
import LuxuryTreeScene from './components/LuxuryTreeScene';

const App: React.FC = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [isLetterModalOpen, setIsLetterModalOpen] = useState(false);
  const [isLetterDisplayOpen, setIsLetterDisplayOpen] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [letterText, setLetterText] = useState("在这个特别的时刻，\n我想告诉你，\n你是我眼中的万千星河。\n\n(请点击右上角上传书信修改此内容)");
  const [displayText, setDisplayText] = useState("");
  
  const treeRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    // Initial loading simulated delay
    const timer = setTimeout(() => setIsLoading(false), 2000);
    return () => clearTimeout(timer);
  }, []);

  const handleFileUpload = (type: 'photo' | 'music' | 'import') => {
    const input = document.createElement('input');
    input.type = 'file';
    if (type === 'photo') {
      input.accept = 'image/*';
      input.multiple = true;
      input.onchange = (e: any) => treeRef.current?.handleImageUpload(e);
    } else if (type === 'music') {
      input.accept = 'audio/*';
      input.onchange = (e: any) => {
        const file = e.target.files?.[0];
        if (file && audioRef.current) {
          const reader = new FileReader();
          reader.onload = (evt) => {
            const data = evt.target?.result as string;
            audioRef.current!.src = data;
            audioRef.current!.play().catch(console.warn);
            treeRef.current?.setMusicData(data);
          };
          reader.readAsDataURL(file);
        }
      };
    } else if (type === 'import') {
      input.accept = '.json';
      input.onchange = (e: any) => {
        const file = e.target.files?.[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (evt) => {
            const content = evt.target?.result as string;
            const data = treeRef.current?.importSceneData(content);
            if (data?.letter) setLetterText(data.letter);
          };
          reader.readAsText(file);
        }
      };
    };
    input.click();
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  };

  const startCamera = async () => {
    try {
      setCameraActive(true);
      if (treeRef.current) {
        await treeRef.current.initCamera();
      }
    } catch (err) {
      console.error("Failed to start camera:", err);
      setCameraActive(false);
    }
  };

  const handleExport = () => {
    treeRef.current?.exportSceneData();
  };

  // Typing effect for the letter display
  useEffect(() => {
    if (isLetterDisplayOpen) {
      let i = 0;
      setDisplayText("");
      const interval = setInterval(() => {
        if (i < letterText.length) {
          setDisplayText(prev => prev + letterText.charAt(i));
          i++;
        } else {
          clearInterval(interval);
        }
      }, 100);
      return () => clearInterval(interval);
    }
  }, [isLetterDisplayOpen, letterText]);

  return (
    <div className="relative w-screen h-screen bg-[#020205] text-[#d4af37] overflow-hidden">
      {/* Loader */}
      {isLoading && (
        <div className="absolute inset-0 z-[100] bg-black flex items-center justify-center transition-opacity duration-1000">
          <div className="w-10 h-10 border-2 border-[rgba(212,175,55,0.1)] border-t-[#d4af37] rounded-full animate-spin"></div>
        </div>
      )}

      {/* Main Canvas */}
      <LuxuryTreeScene 
        ref={treeRef}
        letterContent={letterText}
        onLetterTrigger={() => setIsLetterDisplayOpen(true)}
      />

      {/* UI Overlay */}
      <div className="absolute inset-0 pointer-events-none z-10 flex flex-col">
        {/* Top Controls */}
        <div className="p-5 flex justify-end gap-4 pointer-events-auto">
          {/* Media Column */}
          <div className="flex flex-col gap-3">
            <button onClick={() => handleFileUpload('music')} className="luxury-btn w-32 py-2 rounded-lg flex items-center justify-center gap-2">
              <Music size={16} /> 上传音乐
            </button>
            <button onClick={() => handleFileUpload('photo')} className="luxury-btn w-32 py-2 rounded-lg flex items-center justify-center gap-2">
              <ImageIcon size={16} /> 上传照片
            </button>
            <button onClick={() => setIsLetterModalOpen(true)} className="luxury-btn w-32 py-2 rounded-lg flex items-center justify-center gap-2">
              <FileText size={16} /> 上传书信
            </button>
          </div>

          {/* System Column */}
          <div className="flex flex-col gap-3">
            <button onClick={() => handleFileUpload('import')} className="luxury-btn w-32 py-2 rounded-lg flex items-center justify-center gap-2">
              <Globe size={16} /> 导入网页
            </button>
            <button onClick={handleExport} className="luxury-btn w-32 py-2 rounded-lg flex items-center justify-center gap-2">
              <Download size={16} /> 导出网页
            </button>
            <button onClick={toggleFullscreen} className="luxury-btn w-32 py-2 rounded-lg flex items-center justify-center gap-2">
              <Maximize size={16} /> 全屏显示
            </button>
            {/* Added Webcam Button */}
            {!cameraActive && (
              <button onClick={startCamera} className="luxury-btn w-32 py-2 rounded-lg flex items-center justify-center gap-2 animate-pulse bg-[rgba(212,175,55,0.1)]">
                <Camera size={16} /> 开启摄像头
              </button>
            )}
          </div>
        </div>

        {/* Webcam Viewbox */}
        <div 
          className={`absolute bottom-5 right-5 border border-[rgba(212,175,55,0.5)] rounded bg-black transition-opacity duration-500 pointer-events-auto ${cameraActive ? 'opacity-100' : 'opacity-0'}`}
          style={{ width: '160px', height: '120px' }}
        >
          <video id="webcam" className="hidden" autoPlay playsInline muted></video>
          <canvas id="webcam-preview" className="w-full h-full scale-x-[-1]"></canvas>
        </div>
      </div>

      {/* Letter Editor Modal */}
      {isLetterModalOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/40 pointer-events-auto">
          <div className="w-full max-w-md glass-panel p-6 rounded-xl flex flex-col gap-4 border-[#d4af37]">
            <h3 className="text-xl text-center font-bold">撰写你的心意</h3>
            <textarea 
              className="w-full h-40 bg-white/5 border border-gray-600 rounded p-3 text-white outline-none resize-none"
              placeholder="在这里写下你想说的话..."
              value={letterText}
              onChange={(e) => setLetterText(e.target.value)}
            />
            <div className="flex justify-end gap-3">
              <button onClick={() => setIsLetterModalOpen(false)} className="luxury-btn px-6 py-2 rounded">取消</button>
              <button onClick={() => setIsLetterModalOpen(false)} className="luxury-btn px-6 py-2 rounded font-bold">保存</button>
            </div>
          </div>
        </div>
      )}

      {/* Letter Content Display (Overlay) */}
      {isLetterDisplayOpen && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/40 p-4 transition-opacity duration-1000 pointer-events-auto">
          <div className="relative w-full max-w-lg h-[70vh] bg-white/10 backdrop-blur-md border border-white/30 p-10 flex flex-col animate-in fade-in slide-in-from-bottom-5">
            <button 
              onClick={() => { setIsLetterDisplayOpen(false); treeRef.current?.exitLetterMode(); }} 
              className="absolute top-4 right-4 w-8 h-8 rounded-full border border-white/40 text-white/70 flex items-center justify-center hover:bg-white/20 hover:text-white transition-all"
            >
              <X size={20} />
            </button>
            <div className="flex-1 overflow-y-auto font-chinese text-2xl leading-relaxed text-white/90 whitespace-pre-wrap scroll-smooth">
              {displayText}
              <span className="inline-block w-0.5 h-6 bg-white animate-pulse ml-1 align-middle"></span>
            </div>
          </div>
        </div>
      )}

      <audio ref={audioRef} id="bg-music" loop crossOrigin="anonymous"></audio>
    </div>
  );
};

export default App;
