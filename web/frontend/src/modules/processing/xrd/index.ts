import type { ProcessingStep } from '../common'

export type XrdProcessingInput = unknown

export const xrdProcessingModule = {
  id: 'xrd',
  label: 'XRD',
  createSteps: (): ProcessingStep<XrdProcessingInput>[] => [],
} as const
