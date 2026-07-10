import { useState, useEffect, useRef, useMemo } from "react";
import { 
  Play, 
  Pause, 
  RotateCcw, 
  Zap, 
  Sparkles, 
  Sliders, 
  X, 
  ChevronDown, 
  ChevronUp, 
  FileText, 
  Eye, 
  Settings2,
  ListRestart
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { extractKeyIdeasForSpeedReading } from "../lib/gemini";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";

interface SpeedAmplifierProps {
  defaultTitle: string;
  defaultText: string;
  onClose?: () => void;
}

export function SpeedAmplifier({ defaultTitle, defaultText, onClose }: SpeedAmplifierProps) {
  const [inputText, setInputText] = useState(defaultText);
  const [inputTitle, setInputTitle] = useState(defaultTitle);
  
  // Speed settings
  const [wpm, setWpm] = useState(350);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [mode, setMode] = useState<"ai" | "raw">("ai"); // "ai" uses extracted key ideas, "raw" uses split raw text
  const [customKeyIdeas, setCustomKeyIdeas] = useState<string[]>([]);
  
  // Refs
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const listContainerRef = useRef<HTMLDivElement>(null);

  // Sync state with incoming props for seamless node switching
  useEffect(() => {
    setInputText(defaultText);
    setInputTitle(defaultTitle);
    setCurrentIndex(0);
    setIsPlaying(false);
  }, [defaultTitle, defaultText]);

  // Fallback / Raw Text Chunker: breaks down text into readable 3-6 word semantic phrases
  const rawChunks = useMemo(() => {
    if (!inputText) return [];
    
    // Split into sentences first
    const sentences = inputText
      .replace(/([.?!])\s+/g, "$1|")
      .split("|")
      .map(s => s.trim())
      .filter(Boolean);
      
    const chunks: string[] = [];
    
    sentences.forEach(sentence => {
      // Split by commas or semicolons for smaller sub-clauses
      const subClauses = sentence
        .replace(/([,;:])\s+/g, "$1|")
        .split("|")
        .map(sc => sc.trim())
        .filter(Boolean);
        
      subClauses.forEach(clause => {
        const words = clause.split(/\s+/);
        // Chunk words in groups of 3-5
        for (let i = 0; i < words.length; i += 4) {
          const chunkWords = words.slice(i, i + 4);
          const chunkText = chunkWords.join(" ");
          if (chunkText) {
            chunks.push(chunkText);
          }
        }
      });
    });
    
    return chunks;
  }, [inputText]);

  // AI-extracted key ideas
  const [aiKeyIdeas, setAiKeyIdeas] = useState<string[]>([]);

  // Initialize and load AI key ideas
  useEffect(() => {
    let active = true;
    if (defaultText && mode === "ai") {
      setIsAiLoading(true);
      extractKeyIdeasForSpeedReading(defaultTitle, defaultText)
        .then(ideas => {
          if (!active) return;
          if (ideas && ideas.length > 0) {
            setAiKeyIdeas(ideas);
          } else {
            // Fallback to raw if AI fails
            setMode("raw");
          }
        })
        .catch(() => {
          if (active) setMode("raw");
        })
        .finally(() => {
          if (active) setIsAiLoading(false);
        });
    }
    return () => {
      active = false;
    };
  }, [defaultText, defaultTitle]);

  // Trigger manually to regenerate AI key ideas if title/text changes
  const handleRegenerateAi = async () => {
    setIsAiLoading(true);
    setIsPlaying(false);
    setCurrentIndex(0);
    try {
      const ideas = await extractKeyIdeasForSpeedReading(inputTitle, inputText);
      if (ideas && ideas.length > 0) {
        setAiKeyIdeas(ideas);
        setMode("ai");
      } else {
        alert("Could not extract AI key ideas. Reverting to smart raw chunking.");
        setMode("raw");
      }
    } catch (e) {
      setMode("raw");
    } finally {
      setIsAiLoading(false);
    }
  };

  // Get active array based on mode
  const activeChunks = useMemo(() => {
    if (mode === "ai") {
      return aiKeyIdeas.length > 0 ? aiKeyIdeas : rawChunks;
    }
    return rawChunks;
  }, [mode, aiKeyIdeas, rawChunks]);

  // Handle Play/Pause timing
  useEffect(() => {
    if (isPlaying) {
      if (currentIndex >= activeChunks.length) {
        setIsPlaying(false);
        return;
      }

      const currentChunk = activeChunks[currentIndex] || "";
      const wordCount = currentChunk.split(/\s+/).length || 1;
      
      // Calculate delay: Standard WPM calculation
      // delay = (60000ms / WPM) * wordCount
      // We also enforce a minimum display time of 200ms and max of 2000ms for natural reading pacing
      const delay = Math.max(
        250, 
        Math.min(2000, Math.round((60000 / wpm) * Math.max(1, wordCount * 0.95)))
      );

      timerRef.current = setTimeout(() => {
        setCurrentIndex(prev => {
          const next = prev + 1;
          if (next >= activeChunks.length) {
            setIsPlaying(false);
            return prev;
          }
          return next;
        });
      }, delay);
    } else {
      if (timerRef.current) clearTimeout(timerRef.current);
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isPlaying, currentIndex, activeChunks, wpm]);

  // Keep scroll container focused / aligned
  useEffect(() => {
    if (listContainerRef.current) {
      // Each element is roughly 48px height. We want to align the active item perfectly centered.
      // Offset = (index * height)
    }
  }, [currentIndex]);

  const handleNext = () => {
    if (currentIndex < activeChunks.length - 1) {
      setCurrentIndex(prev => prev + 1);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
    }
  };

  const handleRestart = () => {
    setCurrentIndex(0);
    setIsPlaying(false);
  };

  const progressPercent = activeChunks.length > 0 
    ? Math.round((currentIndex / (activeChunks.length - 1 || 1)) * 100) 
    : 0;

  return (
    <div id="blue-speed-amplifier-panel" className="bg-slate-950/90 border border-blue-500/30 rounded-xl shadow-[0_0_50px_rgba(59,130,246,0.2)] p-6 backdrop-blur-2xl flex flex-col gap-6 relative overflow-hidden h-full">
      {/* Absolute futuristic grid background overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_40%,rgba(59,130,246,0.05)_50%,transparent_60%)] pointer-events-none z-0" />
      
      {/* Top Banner */}
      <div className="flex justify-between items-center z-10">
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center w-9 h-9 rounded-lg bg-blue-500/10 border border-blue-500/30 animate-pulse shadow-[0_0_15px_rgba(59,130,246,0.2)]">
            <Zap className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-bold text-blue-400 tracking-widest uppercase">Pacing Conduit</span>
              <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/30 font-mono text-[9px] px-1.5 py-0.5 animate-pulse">AMPLIFIER ON</Badge>
            </div>
            <h2 className="text-base font-bold text-white tracking-tight">Blue Speed Amplifier</h2>
          </div>
        </div>
        
        {onClose && (
          <Button 
            variant="ghost" 
            size="icon" 
            className="w-8 h-8 rounded-full text-slate-400 hover:text-white hover:bg-white/5 border border-white/5"
            onClick={onClose}
          >
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>

      {/* Tabs / Configuration Selector */}
      <div className="grid grid-cols-2 gap-2 p-1 bg-white/5 border border-white/10 rounded-lg text-xs z-10">
        <button
          onClick={() => { setMode("ai"); setCurrentIndex(0); }}
          className={`py-1.5 rounded-md flex items-center justify-center gap-1.5 font-medium transition-all ${mode === "ai" ? "bg-blue-600 text-white shadow-lg shadow-blue-900/30 border border-blue-400/20" : "text-slate-400 hover:text-slate-200"}`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          AI Synthesis Ideas
        </button>
        <button
          onClick={() => { setMode("raw"); setCurrentIndex(0); }}
          className={`py-1.5 rounded-md flex items-center justify-center gap-1.5 font-medium transition-all ${mode === "raw" ? "bg-blue-600 text-white shadow-lg shadow-blue-900/30 border border-blue-400/20" : "text-slate-400 hover:text-slate-200"}`}
        >
          <FileText className="w-3.5 h-3.5" />
          Direct Smart Chunks
        </button>
      </div>

      {/* Active Stage Panel (The Speed Reader Screen) */}
      <div className="flex-1 min-h-[220px] bg-slate-950 border border-blue-500/20 rounded-xl relative overflow-hidden flex flex-col justify-center items-center p-4 shadow-inner z-10 group">
        {/* Subtle Cyber scanlines */}
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(255,255,255,0.01)_50%,transparent_50%)] bg-[size:100%_4px] pointer-events-none opacity-40" />
        
        {/* Optical Recognition Point Guide lines (Speed-reading standard) */}
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-14 pointer-events-none border-y border-blue-500/20 bg-blue-950/20 z-0">
          {/* Glowing cursor focus indicators */}
          <div className="absolute left-2 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.8)]" />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.8)]" />
        </div>

        {/* AI Loading state */}
        {isAiLoading ? (
          <div className="flex flex-col items-center gap-3 text-slate-400 z-10 py-12">
            <div className="relative w-12 h-12 flex items-center justify-center">
              <div className="absolute inset-0 rounded-full border-2 border-blue-500/20 border-t-blue-400 animate-spin" />
              <Sparkles className="w-5 h-5 text-blue-400 animate-pulse" />
            </div>
            <div className="text-center space-y-1">
              <p className="text-xs font-medium text-blue-300">Extricating core tenets...</p>
              <p className="text-[10px] text-slate-500">Gemini is compiling rapid reading packets</p>
            </div>
          </div>
        ) : activeChunks.length === 0 ? (
          <div className="text-center p-6 text-slate-500 z-10">
            <p className="text-xs">No chunks loaded. Add some text to start.</p>
          </div>
        ) : (
          /* Animated Scrolling Waterfall list of chunks */
          <div className="relative w-full h-[180px] overflow-hidden flex flex-col justify-center items-center z-10">
            <motion.div 
              animate={{ y: -currentIndex * 48 }}
              transition={{ type: "spring", stiffness: 350, damping: 30 }}
              className="flex flex-col gap-0 items-center justify-center py-[66px]"
              style={{ height: `${activeChunks.length * 48}px` }}
            >
              {activeChunks.map((chunk, index) => {
                const isActive = index === currentIndex;
                const isPast = index < currentIndex;
                const distance = Math.abs(index - currentIndex);
                
                // Determine opacity and blur based on distance from central active region
                const opacity = isActive ? 1 : Math.max(0.08, 0.45 - distance * 0.15);
                const scale = isActive ? 1.15 : Math.max(0.8, 1 - distance * 0.08);
                const blur = isActive ? "blur(0px)" : `blur(${distance * 1}px)`;
                
                return (
                  <div
                    key={index}
                    onClick={() => {
                      setCurrentIndex(index);
                      setIsPlaying(false);
                    }}
                    className={`h-[48px] flex items-center justify-center text-center cursor-pointer select-none transition-all duration-300 ${isActive ? "text-blue-300 font-extrabold tracking-tight" : "text-slate-500 font-medium"}`}
                    style={{
                      opacity,
                      transform: `scale(${scale})`,
                      filter: blur,
                    }}
                  >
                    <span className={isActive ? "text-white bg-blue-500/10 px-4 py-1.5 rounded-lg border border-blue-400/30 shadow-[0_0_20px_rgba(59,130,246,0.3)] block max-w-[280px] sm:max-w-[340px] truncate" : "block max-w-[280px] sm:max-w-[340px] truncate"}>
                      {chunk}
                    </span>
                  </div>
                );
              })}
            </motion.div>
          </div>
        )}

        {/* Dynamic pacing indicator / timer display */}
        <div className="absolute bottom-3 right-4 flex items-center gap-2 z-10 bg-slate-900/80 px-2 py-0.5 rounded border border-white/5 text-[9px] font-mono text-blue-400">
          <span>{currentIndex + 1} / {activeChunks.length} PHRASES</span>
          <span className="text-slate-700">|</span>
          <span>{Math.round((activeChunks.length - currentIndex) * (60 / wpm))}s LEFT</span>
        </div>
      </div>

      {/* Speed & Tuning Controls (WPM Customization) */}
      <div className="space-y-4 z-10 bg-white/5 border border-white/10 p-4 rounded-xl">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 text-slate-300">
            <Sliders className="w-3.5 h-3.5 text-blue-400" />
            <span className="font-semibold text-slate-200">WPM Rate Velocity</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-bold text-white bg-blue-500/25 border border-blue-500/40 px-2 py-0.5 rounded shadow-[0_0_10px_rgba(59,130,246,0.15)] animate-pulse">
              {wpm}
            </span>
            <span className="text-[10px] font-mono text-slate-500 uppercase">WPM</span>
          </div>
        </div>

        {/* Interactive WPM Slider */}
        <div className="flex items-center gap-4">
          <span className="text-[10px] font-mono text-slate-500">100</span>
          <input
            type="range"
            min={100}
            max={1000}
            step={25}
            value={wpm}
            onChange={(e) => setWpm(Number(e.target.value))}
            className="flex-1 h-1.5 bg-slate-950 rounded-lg appearance-none cursor-pointer accent-blue-500 hover:accent-blue-400 outline-none focus:ring-1 focus:ring-blue-500/20"
          />
          <span className="text-[10px] font-mono text-slate-500">1000</span>
        </div>

        {/* Rapid Speed Selector Hotkeys */}
        <div className="flex gap-2 justify-between">
          {[250, 350, 450, 600, 800].map((speed) => (
            <button
              key={speed}
              onClick={() => setWpm(speed)}
              className={`flex-1 py-1 rounded font-mono text-[10px] font-bold border transition-all ${wpm === speed ? "bg-blue-600 border-blue-400 text-white shadow-md shadow-blue-900/20" : "bg-black/35 border-white/5 text-slate-400 hover:text-slate-200 hover:bg-black/50"}`}
            >
              {speed}
            </button>
          ))}
        </div>
      </div>

      {/* Playback Controls & Progress Bar */}
      <div className="space-y-4 z-10 mt-auto">
        {/* Glow Blue Progress bar */}
        <div className="h-1 w-full bg-slate-900 rounded-full overflow-hidden border border-white/5">
          <motion.div 
            className="h-full bg-gradient-to-r from-blue-600 via-cyan-500 to-blue-400 shadow-[0_0_10px_rgba(59,130,246,0.6)]"
            animate={{ width: `${progressPercent}%` }}
            transition={{ duration: 0.1 }}
          />
        </div>

        {/* Primary Controls */}
        <div className="flex items-center justify-between gap-3">
          <Button
            variant="outline"
            size="sm"
            className="border-white/10 bg-white/5 hover:bg-white/10 hover:text-white text-slate-400 flex-1 h-9"
            onClick={handleRestart}
            disabled={activeChunks.length === 0}
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
            Restart
          </Button>

          <Button
            variant="outline"
            size="icon"
            className="border-white/10 bg-white/5 hover:bg-white/10 hover:text-white text-slate-400 h-9 w-9"
            onClick={handlePrev}
            disabled={currentIndex === 0 || activeChunks.length === 0}
          >
            <ChevronUp className="w-4 h-4" />
          </Button>

          {/* Core play toggle with glowing aura */}
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            disabled={activeChunks.length === 0}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${isPlaying ? "bg-blue-600 text-white shadow-[0_0_20px_rgba(59,130,246,0.5)] hover:bg-blue-500" : "bg-white text-slate-950 shadow-md hover:bg-slate-100 disabled:opacity-50 disabled:pointer-events-none"}`}
          >
            {isPlaying ? (
              <Pause className="w-5 h-5 fill-current" />
            ) : (
              <Play className="w-5 h-5 fill-current translate-x-0.5" />
            )}
          </button>

          <Button
            variant="outline"
            size="icon"
            className="border-white/10 bg-white/5 hover:bg-white/10 hover:text-white text-slate-400 h-9 w-9"
            onClick={handleNext}
            disabled={currentIndex === activeChunks.length - 1 || activeChunks.length === 0}
          >
            <ChevronDown className="w-4 h-4" />
          </Button>

          {/* Quick config options */}
          <div className="flex items-center gap-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRegenerateAi}
                    disabled={isAiLoading}
                    className="border-white/10 bg-white/5 hover:bg-blue-500/20 text-slate-400 hover:text-blue-300 h-9 w-9 px-0"
                  >
                    <ListRestart className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="bg-slate-950 text-slate-200 border-white/15">
                  <p className="text-xs">Regenerate key ideas via Gemini</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </div>

      {/* Collapsible Source Text Panel */}
      <details className="z-10 group border-t border-white/10 pt-4 mt-1">
        <summary className="list-none flex items-center justify-between text-xs text-slate-400 hover:text-slate-200 cursor-pointer select-none">
          <div className="flex items-center gap-1.5">
            <Settings2 className="w-3.5 h-3.5 text-blue-400/80" />
            <span>Customize Conduit Source Material</span>
          </div>
          <ChevronDown className="w-3.5 h-3.5 transition-transform group-open:rotate-180 text-slate-500" />
        </summary>
        <div className="mt-3 space-y-3 pt-1">
          <div className="space-y-1">
            <label className="text-[10px] font-mono text-slate-500 uppercase tracking-wider block">Conduit Title</label>
            <input 
              type="text" 
              value={inputTitle} 
              onChange={(e) => setInputTitle(e.target.value)}
              className="w-full text-xs bg-slate-950 border border-white/10 rounded px-2.5 py-1.5 text-white focus:outline-none focus:border-blue-500/40"
              placeholder="E.g., Paper title or topic..."
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-mono text-slate-500 uppercase tracking-wider block">Source Text / Narrative Content</label>
            <textarea
              value={inputText}
              onChange={(e) => {
                setInputText(e.target.value);
                setCurrentIndex(0);
                setIsPlaying(false);
              }}
              className="w-full h-24 text-xs bg-slate-950 border border-white/10 rounded p-2 text-slate-300 focus:outline-none focus:border-blue-500/40 font-sans leading-relaxed resize-none"
              placeholder="Paste any article, summary, or textbook chapter here..."
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full border-blue-500/25 bg-blue-500/10 hover:bg-blue-500/25 text-blue-300 h-8 text-[11px]"
              onClick={handleRegenerateAi}
              disabled={isAiLoading || !inputText.trim()}
            >
              <Sparkles className="w-3 h-3 mr-1.5" />
              Analyze Custom Text with Gemini
            </Button>
          </div>
        </div>
      </details>
    </div>
  );
}
