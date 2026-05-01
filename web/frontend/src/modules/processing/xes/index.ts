import type { ProcessingStep } from '../common'

export type XesProcessingInput = unknown

export const xesProcessingModule = {
  id: 'xes',
  label: 'XES',
  createSteps: (): ProcessingStep<XesProcessingInput>[] => [],
} as const
