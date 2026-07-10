import React from 'react';
import { GraphNode } from '../types';
import { format } from 'date-fns';
import { motion } from 'motion/react';

interface TimelineProps {
  nodes: GraphNode[];
  onNodeClick: (node: GraphNode) => void;
  selectedNodeId?: string;
}

export const Timeline: React.FC<TimelineProps> = ({ nodes, onNodeClick, selectedNodeId }) => {
  const sortedNodes = [...nodes].sort((a, b) => (a.year || 0) - (b.year || 0));

  return (
    <div className="relative py-8 px-4 overflow-x-auto">
      <div className="absolute top-1/2 left-0 w-full h-0.5 bg-slate-800 -translate-y-1/2" />
      
      <div className="flex gap-12 min-w-max relative z-10">
        {sortedNodes.map((node, index) => (
          <motion.div
            key={node.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            className="flex flex-col items-center cursor-pointer group"
            onClick={() => onNodeClick(node)}
          >
            <div className="text-xs font-mono text-slate-500 mb-2">
              {node.year || 'Unknown'}
            </div>
            
            <div 
              className={`w-4 h-4 rounded-full border-2 transition-all duration-300 ${
                node.id === selectedNodeId 
                  ? 'bg-orange-500 border-white scale-125' 
                  : 'bg-slate-900 border-blue-500 group-hover:border-blue-400'
              }`}
            />
            
            <div className="mt-4 max-w-[150px] text-center">
              <div className={`text-xs font-medium line-clamp-2 ${
                node.id === selectedNodeId ? 'text-orange-400' : 'text-slate-300'
              }`}>
                {node.title}
              </div>
              <div className="text-[10px] text-slate-500 mt-1">
                {node.authors[0]?.name}{node.authors.length > 1 ? ' et al.' : ''}
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
};
