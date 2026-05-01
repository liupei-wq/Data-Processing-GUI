import type { ProcessingStep } from '../common'

export type XpsProcessingInput = unknown

export const xpsProcessingModule = {
  id: 'xps',
  label: 'XPS',
  createSteps: (): ProcessingStep<XpsProcessingInput>[] => [],
} as const
