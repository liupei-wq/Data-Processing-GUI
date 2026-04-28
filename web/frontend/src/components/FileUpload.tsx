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
          ? 'border-sky-300/80 bg-sky-400/10 shadow-[0_0_0_1px_rgba(125,211,252,0.18)]'
          : 'border-[#385171] bg-[#202938] hover:border-sky-400/45 hover:bg-[#233044]',
        isLoading ? 'cursor-not-allowed opacity-50' : '',
      ].join(' ')}
    >
      <input {...getInputProps()} />
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-sky-300/20 bg-sky-400/10 text-2xl text-sky-100">
        ↑
      </div>
      {isDragActive ? (
        <p className="text-sm font-medium text-sky-100">放開以載入檔案</p>
      ) : (
        <>
          <div className="inline-flex rounded-xl border border-sky-300/55 bg-sky-400/10 px-4 py-2 text-base font-semibold text-slate-100">
            Upload
          </div>
          <p className="mt-4 text-sm font-medium text-slate-100">拖曳或點擊上傳 XRD 檔案</p>
          <p className="mt-1 text-xs text-slate-400">500MB per file • TXT, CSV, XY, ASC, DAT</p>
        </>
      )}
    </div>
  )
}
