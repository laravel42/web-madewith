/** Type declarations for classify.mjs (consumed by the TypeScript Worker). */

export declare const CATEGORIES: readonly string[];
export type Category = string;

export declare const DEFAULT_CATEGORY: Category;
export declare const LOW_CONFIDENCE: number;

export interface ClassifyInput {
  name?: string | null;
  description?: string | null;
  topics?: readonly string[] | null;
}

export interface ClassifyResult {
  category: Category;
  /** 0..1 — below LOW_CONFIDENCE means weak evidence. */
  confidence: number;
  scores: Record<string, number>;
}

export declare function classifyDetailed(input: ClassifyInput): ClassifyResult;
export declare function classify(input: ClassifyInput): Category;
