export type XYPoint = {
  x: number
  y: number
}

export type SpectrumSeries = {
  id: string
  label: string
  points: XYPoint[]
  color?: string
  metadata?: Record<string, unknown>
}

export type ProcessingStepResult<T> = {
  data: T
  metadata: {
    module: string
    operation: string
    parameters?: Record<string, unknown>
    timestamp: string
  }
}

export type ProcessingHistoryItem = ProcessingStepResult<unknown>['metadata']
