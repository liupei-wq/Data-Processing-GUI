import type { ProcessingStep } from '../common'

export type XasProcessingInput = unknown

export const xasProcessingModule = {
  id: 'xas',
  label: 'XAS',
  createSteps: (): ProcessingStep<XasProcessingInput>[] => [],
} as const
