/**
 * Платформонезависимое ядро: парсеры входных файлов, описательная статистика,
 * статкритерии (через Pyodide) и генератор экспертного заключения.
 */

export const CORE_VERSION = '0.5.0';

export {
  parseScattPdf,
  type ScattExportResult,
  type ScattShot,
  type ScattSessionMeta,
} from './parser/scatt-pdf';

export {
  describe,
  type Descriptives,
} from './stats/describe';

export {
  type PyodideLoadStatus,
  type LoadOptions as PyodideLoadOptions,
} from './stats/runtime';

export {
  shapiroWilk,
  decideNormality,
  levene,
  bartlett,
  decideVariance,
  oneWayAnova,
  welchAnova,
  kruskalWallis,
  decideMeans,
  tukeyHsd,
  dunnHolm,
  type ShapiroResult,
  type NormalityVerdict,
  type VarianceResult,
  type VarianceVerdict,
  type GroupMeanResult,
  type MeansVerdict,
  type PairwiseResult,
  type PairwiseComparison,
} from './stats/tests';

export {
  chooseGroupTest,
  type GroupTestChoice,
  type Decision,
} from './stats/decision';

export {
  correlations,
  categorizeStrength,
  describeRelation,
  type CorrelationCell,
  type CorrelationMatrix,
  type CorrelationStrength,
} from './stats/correlations';

export {
  explainResult,
  type ExplainabilityResult,
  type SingleVarFit,
  type MultipleRegression,
  type RegressionCoef,
} from './stats/regression';

export {
  generateConclusion,
  labelOf,
  type ReportSection,
  type ConclusionInput,
} from './report/generate';

export {
  getGroups,
  GROUPING_LABELS,
  type GroupingScheme,
  type Group,
  type MedianSplitSpec,
  type ShotVarGetter,
} from './stats/grouping';
