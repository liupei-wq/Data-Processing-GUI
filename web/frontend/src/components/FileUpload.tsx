import { useCallback } from 'react'
import { useDropzone } from 'react-dropzone'

interface Props {
  onFiles: (files: File[]) => void
  isLoading: boolean
}

export default function FileUpload({ onFiles, isLoading }: Props) {
  const onDrop = useCallback(
    (accepted: File[]) => {
      if (accepted.length > 0) onFiles(accepted)
    },
    [onFiles],
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/plain': ['.txt', '.asc', '.xy', '.dat'],
      'text/csv': ['.csv'],
    },
    disabled: isLoading,
  })

  return (
    <div
      {...getRootProps()}
      className={[
        'cursor-pointer rounded-[22px] border border-dashed p-5 text-center transition-all',
        isDragActive
          ? 'border-cyan-300 bg-cyan-300/12 shadow-[0_0_0_1px_rgba(125,211,252,0.15)]'
          : 'border-white/16 bg-slate-950/35 hover:border-cyan-300/40 hover:bg-white/6',
        isLoading ? 'cursor-not-allowed opacity-50' : '',
      ].join(' ')}
    >
      <input {...getInputProps()} />
      <div className="mb-2 text-3xl">◫</div>
      {isDragActive ? (
        <p className="text-sm font-medium text-cyan-100">放開以載入檔案</p>
      ) : (
        <>
          <p className="text-sm font-medium text-slate-100">拖曳或點擊上傳</p>
          <p className="mt-1 text-xs text-slate-400">.txt / .csv / .xy / .asc / .dat</p>
        </>
      )}
    </div>
  )
}
