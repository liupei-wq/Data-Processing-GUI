export interface XrdDesktopTraceSettings {
  label: string
  shortLabel: string
  color: string
  offset: number
  linewidth: number
  labelX: number
  labelYAdd: number
  xShift?: number
}


export interface XrdDesktopInputFile extends XrdDesktopTraceSettings {
  id: string
  name: string
  x: number[]
  y: number[]
}

export interface XrdDesktopProcessedTrace extends XrdDesktopTraceSettings {
  id: string
  name: string
  x: number[]
  yProcessed: number[]
  yStacked: number[]
  baseline: number
}

export interface XrdDesktopReferenceMarker {
  x: number
  text: string
  lineColor: string
  textYFrac: number
  textXOffset?: number
}

export interface XrdDesktopReferenceDbRow {
  phase: string
  hkl: string
  twoTheta: number
  intensity: number
  tolerance: number
}

export interface XrdDesktopDetectedPeak {
  twoTheta: number
  dSpacing: number | null
  intensity: number
}

export type XrdSignalTransformMode = 'log10' | 'ln' | 'sqrt'
