import { useState, useRef } from "react";
import { Search, BookOpen, Network, Clock, Sparkles, ExternalLink, ChevronRight, Loader2, Infinity, Zap } from "lucide-react";
import { Graph } from "./components/Graph";
import { Timeline } from "./components/Timeline";
import { GraphData, GraphNode, Paper } from "./types";
import { summarizePaper, extractConcepts, analyzeThemes, generateFieldInsight } from "./lib/gemini";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { ScrollArea } from "./components/ui/scroll-area";
import { Badge } from "./components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { Separator } from "./components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./components/ui/tooltip";
import { motion, AnimatePresence } from "motion/react";
import { SpeedAmplifier } from "./components/SpeedAmplifier";

export default function App() {
  const [query, setQuery] = useState("");
  const [yearStart, setYearStart] = useState("");
  const [yearEnd, setYearEnd] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [concepts, setConcepts] = useState<string[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [arxivOnly, setArxivOnly] = useState(false);
  const [fieldInsight, setFieldInsight] = useState<string | null>(null);
  const [isInsightLoading, setIsInsightLoading] = useState(false);
  const [showInsight, setShowInsight] = useState(false);
  const [showSpeedAmplifier, setShowSpeedAmplifier] = useState(false);
  const expandedNodesRef = useRef<Set<string>>(new Set());
  const citationCacheRef = useRef<Record<string, Paper[]>>({});
  const analysisTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setIsLoading(true);
    setSelectedNode(null);
    setConcepts([]);
    setFieldInsight(null);
    setShowInsight(false);
    setError(null);
    expandedNodesRef.current = new Set();
    citationCacheRef.current = {};

    try {
      let yearParam = "";
      if (yearStart && yearEnd) {
        yearParam = `${yearStart}-${yearEnd}`;
      } else if (yearStart) {
        yearParam = `${yearStart}-`;
      } else if (yearEnd) {
        yearParam = `-${yearEnd}`;
      }

      const url = `/api/search?query=${encodeURIComponent(query)}${yearParam ? `&year=${yearParam}` : ""}${arxivOnly ? "&arxivOnly=true" : ""}`;
      const res = await fetch(url);
      
      if (!res.ok) {
        const errData = await res.json();
        const detailMsg = errData.details ? ` (${errData.details})` : "";
        throw new Error(`${errData.error}${detailMsg}` || "Search failed");
      }
      
      const data = await res.json();
      console.log("Search results received:", data);
      
      if (data.data && data.data.length > 0) {
        // Sort by citation count and take top 20 for the graph
        const sortedPapers = [...data.data].sort((a: Paper, b: Paper) => (b.citationCount || 0) - (a.citationCount || 0));
        const top20 = sortedPapers.slice(0, 20);
        
        const nodes: GraphNode[] = top20.map((p: Paper) => ({
          ...p,
          id: p.paperId,
        }));

        setGraphData({ nodes, links: [] });
        analyzeConcepts(nodes);

        // Generate Field Insight
        setIsInsightLoading(true);
        generateFieldInsight(query, yearParam, top20)
          .then(insight => {
            setFieldInsight(insight);
            setShowInsight(true);
          })
          .finally(() => setIsInsightLoading(false));

        // Pre-fetch citations for top 15 papers to make clicks instant
        top20.slice(0, 15).forEach(paper => {
          fetch(`/api/papers/${paper.paperId}/citations`)
            .then(res => res.json())
            .then(citData => {
              if (citData.data) {
                citationCacheRef.current[paper.paperId] = citData.data;
              }
            })
            .catch(() => {});
        });
      } else {
        setError("No papers found for this query and date range.");
        setGraphData({ nodes: [], links: [] });
      }
    } catch (error: any) {
      console.error("Search failed:", error);
      setError(error.message || "Failed to connect to the research database.");
    } finally {
      setIsLoading(false);
    }
  };

  const analyzeConcepts = async (nodes: GraphNode[]) => {
    if (analysisTimeoutRef.current) {
      clearTimeout(analysisTimeoutRef.current);
    }

    analysisTimeoutRef.current = setTimeout(async () => {
      setIsAnalyzing(true);
      try {
        const themes = await analyzeThemes(nodes.slice(0, 20));
        
        const uniqueThemes = Array.from(new Set(themes.map(t => t.theme).filter(Boolean)));
        setConcepts(uniqueThemes);

        setGraphData(prev => {
          const newNodes = prev.nodes.map(n => {
            const themeObj = themes.find(t => t.id === n.id);
            return themeObj ? { ...n, theme: themeObj.theme } : n;
          });
          return { ...prev, nodes: newNodes };
        });
      } catch (error) {
        console.error("Analysis failed:", error);
      } finally {
        setIsAnalyzing(false);
      }
    }, 1000); // 1 second debounce
  };

  const handleNodeClick = async (node: GraphNode) => {
    const existingSummary = summaries[node.id] || node.summary;
    setSelectedNode({ ...node, summary: existingSummary });
    
    // 1. Start citation expansion IMMEDIATELY
    if (!expandedNodesRef.current.has(node.id)) {
      expandedNodesRef.current.add(node.id);
      
      const processCitations = (citations: Paper[]) => {
        setGraphData(prev => {
          const existingIds = new Set(prev.nodes.map(n => n.id));
          const newNodes: GraphNode[] = [];
          const newLinks: any[] = [];

          citations.forEach((p: Paper) => {
            if (!existingIds.has(p.paperId)) {
              newNodes.push({ ...p, id: p.paperId, isCitation: true });
              existingIds.add(p.paperId);
            }
            newLinks.push({ source: p.paperId, target: node.id });
          });

          if (newNodes.length === 0 && newLinks.length === 0) return prev;

          const updatedNodes = [...prev.nodes, ...newNodes];
          // Trigger AI analysis OUTSIDE of the state setter
          setTimeout(() => analyzeConcepts(updatedNodes), 100);

          // Pre-fetch citations for the new nodes to make subsequent clicks instant
          newNodes.forEach(newNode => {
            if (!citationCacheRef.current[newNode.id]) {
              fetch(`/api/papers/${newNode.id}/citations`)
                .then(res => res.json())
                .then(data => {
                  if (data.data) {
                    citationCacheRef.current[newNode.id] = data.data;
                  }
                })
                .catch(() => {}); // Silent fail for pre-fetch
            }
          });

          return {
            nodes: updatedNodes,
            links: [...prev.links, ...newLinks]
          };
        });
      };

      // Check cache first
      if (citationCacheRef.current[node.id]) {
        processCitations(citationCacheRef.current[node.id]);
      } else {
        fetch(`/api/papers/${node.id}/citations`)
          .then(res => res.json())
          .then(data => {
            if (data.data && data.data.length > 0) {
              citationCacheRef.current[node.id] = data.data;
              processCitations(data.data);
            }
          })
          .catch(error => console.error("Failed to fetch citations:", error));
      }
    }

    // 2. Handle summary generation (non-blocking)
    if (!existingSummary) {
      summarizePaper(node.title, node.abstract).then(summary => {
        setSummaries(prev => ({ ...prev, [node.id]: summary }));
        setSelectedNode(prev => prev?.id === node.id ? { ...prev, summary } : prev);
      });
    }
  };

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-transparent text-slate-200 font-sans selection:bg-cyan-500/30 relative">
        {/* Infinite Utopian Scientific Background */}
        <div className="fixed inset-0 z-[-1] bg-[#020617] overflow-hidden">
          {/* Glowing Orbs */}
          <div className="absolute top-[-20%] left-[-10%] w-[70%] h-[70%] rounded-full bg-cyan-600/10 blur-[120px] mix-blend-screen animate-pulse" style={{ animationDuration: '8s' }} />
          <div className="absolute bottom-[-20%] right-[-10%] w-[70%] h-[70%] rounded-full bg-indigo-600/10 blur-[120px] mix-blend-screen animate-pulse" style={{ animationDuration: '12s' }} />
          
          {/* Infinite Perspective Grid */}
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#4f4f4f15_1px,transparent_1px),linear-gradient(to_bottom,#4f4f4f15_1px,transparent_1px)] bg-[size:3rem_3rem] [mask-image:radial-gradient(ellipse_80%_80%_at_50%_50%,#000_20%,transparent_100%)]" />
          
          {/* Subtle overlay to deepen the center */}
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#020617]/50 to-[#020617]" />
        </div>

        {/* Header */}
        <header className="border-b border-white/10 bg-slate-950/30 backdrop-blur-xl sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
            <Tooltip>
              <TooltipTrigger className="flex items-center gap-2 cursor-help outline-none">
                <div className="relative w-8 h-8 flex items-center justify-center">
                  <div className="absolute inset-[-4px] bg-gradient-to-r from-cyan-400 via-white to-purple-400 rounded-full blur-md animate-pulse opacity-70"></div>
                  <div className="absolute inset-0 bg-white rounded-full shadow-[0_0_20px_rgba(255,255,255,0.9)]"></div>
                  <Infinity className="w-5 h-5 text-slate-900 relative z-10" />
                </div>
                <h1 className="text-xl font-bold tracking-tight text-white">Omniscientia</h1>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="start" className="bg-slate-950/90 border-white/10 text-cyan-50 backdrop-blur-xl shadow-2xl shadow-cyan-900/20 max-w-[250px] p-3">
                <p className="text-sm font-medium leading-relaxed">
                  <span className="text-cyan-400 font-bold">Omniscientia</span> — Empowering literature search and graph analysis.
                </p>
              </TooltipContent>
            </Tooltip>
            
            <div className="flex-1 max-w-2xl mx-8 flex gap-2">
              <div className="relative flex-1 group">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 group-focus-within:text-blue-400 transition-colors" />
                <Input 
                  placeholder="Search research field, topic, or paper..." 
                  className="pl-10 bg-white/5 border-white/10 focus:border-cyan-500/50 focus:ring-cyan-500/20 transition-all text-white placeholder:text-slate-500"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                />
              </div>
              <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-md px-2 backdrop-blur-sm">
                <Input 
                  placeholder="From" 
                  className="w-16 h-8 bg-transparent border-none p-0 text-xs text-center focus-visible:ring-0"
                  value={yearStart}
                  onChange={(e) => setYearStart(e.target.value)}
                />
                <span className="text-slate-600">-</span>
                <Input 
                  placeholder="To" 
                  className="w-16 h-8 bg-transparent border-none p-0 text-xs text-center focus-visible:ring-0"
                  value={yearEnd}
                  onChange={(e) => setYearEnd(e.target.value)}
                />
              </div>
              <Button 
                variant="ghost" 
                size="sm"
                className={`h-10 px-3 border border-white/10 transition-all ${arxivOnly ? 'bg-orange-500/20 text-orange-400 border-orange-500/30' : 'bg-white/5 text-slate-400'}`}
                onClick={() => setArxivOnly(!arxivOnly)}
              >
                arXiv
              </Button>
              {isLoading && (
                <div className="flex items-center">
                  <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                </div>
              )}
            </div>

            <div className="flex items-center gap-4">
              <Badge variant="outline" className="border-slate-800 text-slate-400 font-mono text-[10px] uppercase tracking-wider">
                v1.0.4-beta
              </Badge>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-6 py-8 grid grid-cols-12 gap-8 h-[calc(100vh-64px)]">
          {/* Left Panel: Graph & Timeline */}
          <div className="col-span-12 lg:col-span-8 flex flex-col gap-6 h-full overflow-hidden">
            <Tabs defaultValue="graph" className="flex-1 flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <TabsList className="bg-white/5 border border-white/10 p-1 backdrop-blur-md">
                  <TabsTrigger value="graph" className="data-[state=active]:bg-cyan-600/80 data-[state=active]:text-white">
                    <Network className="w-4 h-4 mr-2" />
                    Knowledge Graph
                  </TabsTrigger>
                  <TabsTrigger value="timeline" className="data-[state=active]:bg-cyan-600/80 data-[state=active]:text-white">
                    <Clock className="w-4 h-4 mr-2" />
                    Timeline
                  </TabsTrigger>
                </TabsList>

                <div className="flex items-center gap-3">
                  {fieldInsight && (
                    <Button
                      variant="outline"
                      size="sm"
                      className={`border-white/10 transition-all ${showInsight ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' : 'bg-white/5 text-slate-400'}`}
                      onClick={() => setShowInsight(!showInsight)}
                    >
                      <Sparkles className="w-4 h-4 mr-2" />
                      Field Insight
                    </Button>
                  )}
                  {graphData.nodes.length > 0 && (
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="border-white/10 bg-white/5 hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/30 text-slate-400 transition-all"
                      onClick={() => {
                        setGraphData({ nodes: [], links: [] });
                        setSelectedNode(null);
                        expandedNodesRef.current = new Set();
                        citationCacheRef.current = {};
                      }}
                    >
                      Reset Graph
                    </Button>
                  )}
                  {concepts.length > 0 && (
                    <div className="flex gap-2 overflow-x-auto pb-1 max-w-[400px]">
                    {concepts.map((concept, i) => (
                      <Badge key={i} variant="secondary" className="bg-cyan-500/10 text-cyan-400 border-cyan-500/20 whitespace-nowrap backdrop-blur-md">
                        {concept}
                      </Badge>
                    ))}
                  </div>
                )}
                </div>
              </div>

              <TabsContent value="graph" className="flex-1 bg-white/5 backdrop-blur-md rounded-xl border border-white/10 relative overflow-hidden mt-0 shadow-2xl shadow-black/50">
                {error ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-red-400 gap-4 p-8 text-center">
                    <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center border border-red-500/20">
                      <Search className="w-8 h-8 opacity-50" />
                    </div>
                    <div className="space-y-2">
                      <p className="text-sm font-medium">{error.includes("429") ? "Rate limit exceeded. The research database is busy." : error}</p>
                      {error.includes("429") && (
                        <p className="text-xs text-slate-500 max-w-md">
                          OpenAlex has a rate limit for free users. I've implemented automatic retries, but you may need to wait a minute before searching again.
                        </p>
                      )}
                    </div>
                    <Button variant="outline" size="sm" className="border-slate-800" onClick={handleSearch}>
                      {error.includes("429") ? "Try Again in a Moment" : "Retry Search"}
                    </Button>
                  </div>
                ) : graphData.nodes.length > 0 ? (
                  <Graph 
                    data={graphData} 
                    onNodeClick={handleNodeClick} 
                    selectedNodeId={selectedNode?.id} 
                  />
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 gap-4">
                    <div className="w-16 h-16 rounded-full bg-slate-900 flex items-center justify-center border border-slate-800">
                      <Search className="w-8 h-8 opacity-20" />
                    </div>
                    <p className="text-sm font-medium">Search for a topic to visualize the knowledge cloud</p>
                  </div>
                )}

                {/* Field Insight Overlay */}
                <AnimatePresence>
                  {showInsight && fieldInsight && (
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 20 }}
                      className="absolute top-4 right-4 left-4 md:left-auto md:w-96 z-20"
                    >
                      <Card className="bg-slate-950/90 backdrop-blur-2xl border-cyan-500/30 shadow-[0_0_30px_rgba(6,182,212,0.15)]">
                        <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between space-y-0">
                          <div className="flex items-center gap-2 text-cyan-400 text-[10px] font-bold uppercase tracking-[0.2em]">
                            <Sparkles className="w-3 h-3" />
                            Historical Synthesis
                          </div>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-6 w-6 text-slate-500 hover:text-white"
                            onClick={() => setShowInsight(false)}
                          >
                            <ChevronRight className="w-4 h-4 rotate-90" />
                          </Button>
                        </CardHeader>
                        <CardContent className="p-4 pt-0">
                          <p className="text-sm leading-relaxed text-slate-200 font-medium italic">
                            "{fieldInsight}"
                          </p>
                          <div className="mt-3 pt-3 border-t border-white/5 flex justify-between items-center">
                            <span className="text-[9px] text-slate-500 uppercase tracking-wider">AI Generated Perspective</span>
                            <Badge variant="outline" className="text-[9px] border-cyan-500/20 text-cyan-500/70">
                              {query}
                            </Badge>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Loading Insight Indicator */}
                {isInsightLoading && (
                  <div className="absolute top-4 right-4 z-20">
                    <Badge className="bg-slate-950/80 backdrop-blur-md border-white/10 text-slate-400 flex items-center gap-2 py-1.5 px-3">
                      <Loader2 className="w-3 h-3 animate-spin text-cyan-500" />
                      Synthesizing Field History...
                    </Badge>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="timeline" className="flex-1 bg-white/5 backdrop-blur-md rounded-xl border border-white/10 mt-0 overflow-hidden shadow-2xl shadow-black/50">
                <ScrollArea className="h-full">
                  <Timeline 
                    nodes={graphData.nodes} 
                    onNodeClick={handleNodeClick} 
                    selectedNodeId={selectedNode?.id} 
                  />
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </div>

          {/* Right Panel: Details */}
          <div className="col-span-12 lg:col-span-4 h-full overflow-hidden flex flex-col">
            <AnimatePresence mode="wait">
              {selectedNode ? (
                showSpeedAmplifier ? (
                  <motion.div
                    key="speed-amplifier"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="flex-1 min-h-0 flex flex-col"
                  >
                    <SpeedAmplifier 
                      defaultTitle={selectedNode.title} 
                      defaultText={selectedNode.summary || selectedNode.abstract || ""} 
                      onClose={() => setShowSpeedAmplifier(false)} 
                    />
                  </motion.div>
                ) : (
                  <motion.div
                    key={selectedNode.id}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="flex-1 min-h-0 flex flex-col"
                  >
                    <Card className="bg-white/5 backdrop-blur-xl border-white/10 h-full flex flex-col overflow-hidden shadow-2xl shadow-black/50">
                      <CardHeader className="pb-4 shrink-0">
                        <div className="flex justify-between items-center mb-2">
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-7 px-2 text-slate-500 hover:text-slate-300 hover:bg-white/5"
                            onClick={() => setSelectedNode(null)}
                          >
                            <ChevronRight className="w-4 h-4 mr-1 rotate-180" />
                            Back to Summary
                          </Button>
                        </div>
                        <div className="flex justify-between items-start gap-4">
                          <div className="flex gap-2">
                            <Badge className="bg-cyan-500/20 text-cyan-300 border-cyan-500/30">
                              {selectedNode.year || 'N/A'}
                            </Badge>
                            {selectedNode.externalIds?.ArXiv && (
                              <Badge variant="outline" className="bg-orange-500/10 text-orange-400 border-orange-500/20">
                                arXiv:{selectedNode.externalIds.ArXiv}
                              </Badge>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <Badge variant="outline" className="border-white/20 text-slate-300 bg-black/20">
                              {selectedNode.citationCount} Citations
                            </Badge>
                          </div>
                        </div>
                        <CardTitle className="text-xl leading-tight text-white mt-2">
                          {selectedNode.title}
                        </CardTitle>
                        <CardDescription className="text-slate-400 mt-2">
                          {selectedNode.authors.map(a => a.name).join(", ")}
                        </CardDescription>
                      </CardHeader>
                      
                      <Separator className="bg-white/10 shrink-0" />
                      
                      <ScrollArea className="flex-1 min-h-0">
                        <CardContent className="pt-6 space-y-6">
                          {/* AI Summary Section */}
                          <div className="space-y-3">
                            <div className="flex items-center gap-2 text-cyan-400 text-xs font-bold uppercase tracking-widest">
                              <Sparkles className="w-3 h-3" />
                              AI Insight Summary
                            </div>
                            <div className="bg-cyan-500/5 border border-cyan-500/10 rounded-lg p-4 text-sm leading-relaxed text-slate-300 italic backdrop-blur-sm">
                              {selectedNode.summary || (
                                <div className="flex items-center gap-2 text-slate-500">
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                  Generating summary...
                                </div>
                              )}
                            </div>
                            <Button
                              variant="outline"
                              className="w-full border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20 text-blue-300 transition-all font-semibold h-10"
                              onClick={() => setShowSpeedAmplifier(true)}
                            >
                              <Zap className="w-4 h-4 mr-2 text-blue-400 animate-pulse" />
                              Launch Blue Speed Amplifier
                            </Button>
                          </div>

                          {/* Abstract Section */}
                          <div className="space-y-3">
                            <div className="flex items-center gap-2 text-slate-500 text-xs font-bold uppercase tracking-widest">
                              <BookOpen className="w-3 h-3" />
                              Abstract
                            </div>
                            <p className="text-sm leading-relaxed text-slate-400">
                              {selectedNode.abstract || "No abstract available for this publication."}
                            </p>
                          </div>

                          {/* Links */}
                          <div className="pt-4">
                            <Button 
                              variant="outline" 
                              className="w-full border-white/10 bg-white/5 hover:bg-white/10 text-slate-200 transition-colors"
                              onClick={() => selectedNode.url && window.open(selectedNode.url, '_blank')}
                            >
                              View Source
                              <ExternalLink className="w-4 h-4 ml-2" />
                            </Button>
                          </div>
                        </CardContent>
                      </ScrollArea>
                    </Card>
                  </motion.div>
                )
              ) : (
                <ScrollArea className="flex-1 min-h-0 bg-white/5 backdrop-blur-md rounded-xl border border-white/10 shadow-2xl shadow-black/50">
                  <div className="h-full flex flex-col p-6">
                    {graphData.nodes.length > 0 ? (
                      <div className="space-y-6">
                        <div className="flex items-center gap-2 text-cyan-400 text-xs font-bold uppercase tracking-widest">
                          <Sparkles className="w-3 h-3" />
                          Summary Statistics
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4">
                          <Card className="bg-white/5 backdrop-blur-md border-white/10 shadow-xl">
                            <CardHeader className="pb-2">
                              <CardDescription className="text-slate-400">Total Results</CardDescription>
                              <CardTitle className="text-3xl text-white">{graphData.nodes.length}</CardTitle>
                            </CardHeader>
                          </Card>
                          <Card className="bg-white/5 backdrop-blur-md border-white/10 shadow-xl">
                            <CardHeader className="pb-2">
                              <CardDescription className="text-slate-400">Connections</CardDescription>
                              <CardTitle className="text-3xl text-white">{graphData.links.length}</CardTitle>
                            </CardHeader>
                          </Card>
                        </div>

                        <div className="space-y-3 pt-4">
                          <h3 className="text-sm font-medium text-slate-300">Top 20 Most Cited Papers</h3>
                          <div className="space-y-3">
                            {[...graphData.nodes]
                              .sort((a, b) => (b.citationCount || 0) - (a.citationCount || 0))
                              .slice(0, 20)
                              .map((node, i) => (
                                <div 
                                  key={node.id} 
                                  className="p-3 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 cursor-pointer transition-colors backdrop-blur-sm"
                                  onClick={() => handleNodeClick(node)}
                                >
                                  <div className="flex justify-between items-start gap-2">
                                    <h4 className="text-sm font-medium text-slate-200 line-clamp-2">
                                      {node.isCitation && <span className="text-purple-400 mr-1">✦</span>}
                                      {node.title}
                                    </h4>
                                    <Badge variant="secondary" className={`shrink-0 border ${node.isCitation ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' : 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20'}`}>
                                      {node.citationCount}
                                    </Badge>
                                  </div>
                                  <div className="flex items-center gap-2 mt-2 text-xs text-slate-500">
                                    <span>{node.year || 'N/A'}</span>
                                    <span>•</span>
                                    <span className="truncate">{node.authors.map(a => a.name).join(", ")}</span>
                                  </div>
                                </div>
                              ))}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex-1 flex flex-col items-center justify-center text-center p-8 border border-dashed border-white/20 rounded-xl bg-black/20 backdrop-blur-sm min-h-[400px]">
                        <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mb-4 border border-white/10 shadow-inner">
                          <ChevronRight className="w-6 h-6 text-cyan-500/70" />
                        </div>
                        <h3 className="text-slate-300 font-medium tracking-wide">Select a node</h3>
                        <p className="text-sm text-slate-500 mt-2 max-w-[250px]">Click on a paper in the graph or timeline to view detailed insights and AI summaries.</p>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              )}
            </AnimatePresence>
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
}

