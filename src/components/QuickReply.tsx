import React from 'react';

interface QuickReplyProps {
  text: string;
  onClick: () => void;
}

export function QuickReply({ text, onClick }: QuickReplyProps) {
  return (
    <button
      onClick={onClick}
      className="px-5 py-2.5 bg-[#4A90FF] text-white rounded-2xl hover:bg-blue-600 transition-all text-sm shadow-sm flex items-center gap-2"
    >
      {text}
    </button>
  );
}