import type { ProcessingStep } from '../common'

export type RamanProcessingInput = unknown

export const ramanProcessingModule = {
  id: 'raman',
  label: 'Raman',
  createSteps: (): ProcessingStep<RamanProcessingInput>[] => [],
} as const
