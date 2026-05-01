import type { ProcessingHistoryItem, ProcessingStepResult } from './types'

export type ProcessingStep<T> = {
  id: string
  enabled: boolean
  run: (input: T) => ProcessingStepResult<T>
}

export function runProcessingPipeline<T>(
  input: T,
  steps: ProcessingStep<T>[],
): {
  data: T
  history: ProcessingHistoryItem[]
} {
  return steps.reduce(
    (state, step) => {
      if (!step.enabled) return state

      const result = step.run(state.data)
      return {
        data: result.data,
        history: [...state.history, result.metadata],
      }
    },
    { data: input, history: [] as ProcessingHistoryItem[] },
  )
}
