export interface Paper {
  paperId: string;
  title: string;
  authors: { name: string }[];
  abstract: string | null;
  year: number | null;
  citationCount: number;
  influentialCitationCount: number;
  externalIds?: { DOI?: string; ArXiv?: string };
  url?: string;
}

export interface GraphNode extends Paper {
  id: string;
  x?: number;
  y?: number;
  summary?: string;
  concepts?: string[];
  theme?: string;
  isCitation?: boolean;
}

export interface GraphLink {
  source: string;
  target: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}
