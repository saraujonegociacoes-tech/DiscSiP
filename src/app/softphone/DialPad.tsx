'use client'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#']

interface DialPadProps {
  onKey: (key: string) => void
}

export function DialPad({ onKey }: DialPadProps) {
  return (
    <div className="grid grid-cols-3 gap-2 mt-3">
      {KEYS.map((key) => (
        <button
          key={key}
          onClick={() => onKey(key)}
          className="bg-[#1a2234] hover:bg-[#243050] active:scale-95 text-white font-semibold py-4 rounded-xl transition-all text-base select-none"
        >
          {key}
        </button>
      ))}
    </div>
  )
}
