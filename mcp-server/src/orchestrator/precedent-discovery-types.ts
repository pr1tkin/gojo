import type { PatternKind } from '../patterns/types.js';
import type { PatternStructuralAlignment } from '../patterns/structural-alignment.js';
import type { ResultExplainability } from './types.js';

export interface FindPrecedentsInput {
  symbolId?: string;
  patternId?: string;
  fileId?: string;
  limit?: number;
  repoId?: string;
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
  explanation?: ResultExplainability;
}

export interface PrecedentDiscoveryResult {
  target: PrecedentDiscoveryTarget;
  candidates: PrecedentCandidate[];
  totalCandidateCount: number;
  summary: string;
}
