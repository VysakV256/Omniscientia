import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { GraphData, GraphNode } from '../types';
import { ScrollArea } from './ui/scroll-area';

interface GraphProps {
  data: GraphData;
  onNodeClick: (node: GraphNode) => void;
  selectedNodeId?: string;
}

export const Graph: React.FC<GraphProps> = ({ data, onNodeClick, selectedNodeId }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const onNodeClickRef = useRef(onNodeClick);

  useEffect(() => {
    onNodeClickRef.current = onNodeClick;
  }, [onNodeClick]);

  useEffect(() => {
    if (!svgRef.current || !data.nodes.length) return;

    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const g = svg.append("g");

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });

    svg.call(zoom);

    const colorScale = d3.scaleOrdinal(d3.schemeCategory10);

    // Clone data to prevent D3 from mutating React state and causing reference errors
    const d3Nodes = data.nodes.map(d => ({ ...d }));
    const d3Links = data.links.map(d => ({ 
      ...d, 
      source: typeof d.source === 'object' ? (d.source as any).id : d.source,
      target: typeof d.target === 'object' ? (d.target as any).id : d.target
    }));

    const radiusScale = d3.scaleSqrt()
      .domain([0, d3.max(d3Nodes, d => d.citationCount) || 1000])
      .range([5, 35]);

    const simulation = d3.forceSimulation<GraphNode>(d3Nodes)
      .force("link", d3.forceLink<GraphNode, any>(d3Links).id(d => d.id).distance(100))
      .force("charge", d3.forceManyBody().strength(-400))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide<GraphNode>().radius(d => radiusScale(d.citationCount || 0) + 10))
      .force("x", d3.forceX<GraphNode>(width / 2).strength(0.05))
      .force("y", d3.forceY<GraphNode>(height / 2).strength(0.05));

    // Optional: add a clustering force based on theme
    const themesList = Array.from(new Set(d3Nodes.map(d => d.theme).filter(Boolean)));
    if (themesList.length > 0) {
      const themeCenters = new Map();
      themesList.forEach((theme, i) => {
        const angle = (i / themesList.length) * 2 * Math.PI;
        const radius = Math.min(width, height) / 3;
        themeCenters.set(theme, {
          x: width / 2 + radius * Math.cos(angle),
          y: height / 2 + radius * Math.sin(angle)
        });
      });

      simulation.force("cluster", d3.forceX<GraphNode>(d => d.theme && themeCenters.has(d.theme) ? themeCenters.get(d.theme).x : width / 2).strength(0.1));
      simulation.force("clusterY", d3.forceY<GraphNode>(d => d.theme && themeCenters.has(d.theme) ? themeCenters.get(d.theme).y : height / 2).strength(0.1));
    }

    const link = g.append("g")
      .attr("stroke", "#444")
      .attr("stroke-opacity", 0.6)
      .selectAll("line")
      .data(d3Links)
      .join("line")
      .attr("stroke-width", 1);

    const node = g.append("g")
      .selectAll("g")
      .data(d3Nodes)
      .join("g")
      .attr("class", "graph-node")
      .attr("cursor", "pointer")
      .on("click", (event, d) => onNodeClickRef.current(d))
      .call(d3.drag<SVGGElement, GraphNode>()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended) as any);

    node.append("title")
      .text(d => `${d.title}\n\nAuthors: ${d.authors.map(a => a.name).join(", ")}\n\nYear: ${d.year}\n\nCitations: ${d.citationCount}${d.theme ? `\n\nTheme: ${d.theme}` : ''}`);

    node.append("circle")
      .attr("r", d => radiusScale(d.citationCount || 0))
      .attr("fill", d => {
        if (d.id === selectedNodeId) return "#f97316";
        if (d.isCitation) return "#a855f7"; // Purple for citations
        return d.theme ? colorScale(d.theme) as string : "#3b82f6";
      })
      .attr("fill-opacity", 0.8)
      .attr("stroke", d => d.id === selectedNodeId ? "#fff" : (d.isCitation ? "#7e22ce" : "#1e40af"))
      .attr("stroke-width", 2);

    node.append("text")
      .attr("dx", 14)
      .attr("dy", ".35em")
      .text(d => d.title.length > 25 ? d.title.substring(0, 25) + "..." : d.title)
      .attr("font-size", "10px")
      .attr("fill", "#cbd5e1")
      .attr("font-weight", "normal")
      .style("pointer-events", "none")
      .style("text-shadow", "0 1px 2px rgba(0,0,0,0.8)");

    simulation.on("tick", () => {
      link
        .attr("x1", d => (d.source as any).x)
        .attr("y1", d => (d.source as any).y)
        .attr("x2", d => (d.target as any).x)
        .attr("y2", d => (d.target as any).y);

      node
        .attr("transform", d => `translate(${d.x},${d.y})`);
    });

    function dragstarted(event: any) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      event.subject.fx = event.subject.x;
      event.subject.fy = event.subject.y;
    }

    function dragged(event: any) {
      event.subject.fx = event.x;
      event.subject.fy = event.y;
    }

    function dragended(event: any) {
      if (!event.active) simulation.alphaTarget(0);
      event.subject.fx = null;
      event.subject.fy = null;
    }

    return () => {
      simulation.stop();
    };
  }, [data]); // Only re-run when data changes

  // Separate effect for highlighting selected node
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    const colorScale = d3.scaleOrdinal(d3.schemeCategory10);
    
    svg.selectAll(".graph-node circle")
      .attr("fill", (d: any) => {
        if (d.id === selectedNodeId) return "#f97316";
        if (d.isCitation) return "#a855f7";
        return d.theme ? colorScale(d.theme) as string : "#3b82f6";
      })
      .attr("stroke", (d: any) => {
        if (d.id === selectedNodeId) return "#fff";
        return d.isCitation ? "#7e22ce" : "#1e40af";
      });

    svg.selectAll(".graph-node text")
      .attr("font-weight", (d: any) => d.id === selectedNodeId ? "bold" : "normal");
  }, [selectedNodeId]);

  const themes = Array.from(new Set(data.nodes.map(d => d.theme).filter(Boolean))) as string[];
  const colorScale = d3.scaleOrdinal(d3.schemeCategory10);

  return (
    <div className="relative w-full h-full">
      <svg 
        ref={svgRef} 
        className="w-full h-full bg-transparent rounded-lg overflow-hidden"
        style={{ minHeight: '500px' }}
      />
      
      {/* Legend */}
      <div className="absolute bottom-4 left-4 flex flex-col gap-3 bg-slate-950/80 backdrop-blur-xl p-4 rounded-xl border border-white/10 shadow-2xl max-h-[60%] overflow-hidden">
        <div className="text-[10px] font-bold text-cyan-500 uppercase tracking-[0.2em] mb-1">Knowledge Graph Legend</div>
        <ScrollArea className="flex-1 pr-4">
          <div className="flex flex-col gap-3">
            {/* Core Node Types */}
            <div className="space-y-2">
              <div className="text-[9px] text-slate-500 uppercase font-semibold">Node Types</div>
              <div className="grid grid-cols-1 gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-[#f97316] border border-white/50 shadow-[0_0_8px_rgba(249,115,22,0.5)]" />
                  <span className="text-[11px] text-white font-medium">Selected Paper</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-[#a855f7] border border-purple-400/30" />
                  <span className="text-[11px] text-slate-300">Citation Expansion</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-[#3b82f6] border border-blue-400/30" />
                  <span className="text-[11px] text-slate-300">Search Result</span>
                </div>
              </div>
            </div>

            {/* Themes */}
            {themes.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-white/5">
                <div className="text-[9px] text-slate-500 uppercase font-semibold">Thematic Clusters</div>
                <div className="grid grid-cols-1 gap-2">
                  {themes.map((theme) => (
                    <div key={theme} className="flex items-center gap-2">
                      <div 
                        className="w-3 h-3 rounded-full shrink-0" 
                        style={{ backgroundColor: colorScale(theme) as string }}
                      />
                      <span className="text-[11px] text-slate-300 leading-tight">{theme}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="pt-2 border-t border-white/5">
              <div className="text-[9px] text-slate-500 uppercase font-semibold mb-1">Node Size</div>
              <div className="flex items-center gap-2">
                <div className="flex items-end gap-1 h-4">
                  <div className="w-1 h-1 bg-slate-500 rounded-full" />
                  <div className="w-2 h-2 bg-slate-500 rounded-full" />
                  <div className="w-3 h-3 bg-slate-500 rounded-full" />
                </div>
                <span className="text-[10px] text-slate-400">Relative Citations</span>
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  );
};
