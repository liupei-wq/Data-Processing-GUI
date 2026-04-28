import { useCallback } from 'react'
import { useDropzone } from 'react-dropzone'

interface Props {
  onFiles: (files: File[]) => void
  isLoading: boolean
}

/**
 * Drag-and-drop file upload zone.
 * Accepts .txt / .csv / .xy / .asc files.
 */
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
        'border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors',
        isDragActive
          ? 'border-blue-500 bg-blue-50'
          : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50',
        isLoading ? 'opacity-50 cursor-not-allowed' : '',
      ].join(' ')}
    >
      <input {...getInputProps()} />
      <div className="text-2xl mb-1">📂</div>
      {isDragActive ? (
        <p className="text-sm text-blue-600 font-medium">放開以載入檔案</p>
      ) : (
        <>
          <p className="text-sm text-slate-600 font-medium">拖曳或點擊上傳</p>
          <p className="text-xs text-slate-400 mt-1">.txt / .csv / .xy / .asc</p>
        </>
      )}
    </div>
  )
}
