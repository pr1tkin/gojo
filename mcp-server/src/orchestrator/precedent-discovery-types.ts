import type { PatternKind } from '../patterns/types.js';
import type { PatternStructuralAlignment } from '../patterns/structural-alignment.js';

export interface FindPrecedentsInput {
  symbolId?: string;
  patternId?: string;
  fileId?: string;
  limit?: number;
}

export interface PrecedentDiscoveryTarget {
  symbolId?: string;
  patternId?: string;
  fileId: string | null;
  filePath: string | null;
  repoId: string | null;
  symbolName?: string;
  patternKind?: PatternKind;
}

export interface PrecedentCandidate {
  symbolId?: string;
  patternId: string;
  fileId: string;
  filePath: string;
  repoId: string;
  symbolName: string;
  patternKind: PatternKind;
  similarityScore: number;
  precedentScore: number;
  reasonSignals: string[];
  structuralAlignment: PatternStructuralAlignment;
}

export interface PrecedentDiscoveryResult {
  target: PrecedentDiscoveryTarget;
  candidates: PrecedentCandidate[];
  summary: string;
}
