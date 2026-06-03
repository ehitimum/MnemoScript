import { useEffect, useRef } from "react";

interface EditorProps {
  content: string;
  onChange: (content: string) => void;
  selectedWork: {
    id: string;
    name: string;
    type: string;
    content: string;
  };
}

export function Editor({ content, onChange, selectedWork }: EditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [selectedWork.id]);

  return (
    <div className="flex-1 bg-[#1e1e1e] overflow-hidden">
      <textarea
        ref={textareaRef}
        value={content}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-full p-6 bg-transparent text-[#cccccc] resize-none outline-none font-mono text-base leading-relaxed"
        placeholder="Start writing..."
        spellCheck={false}
      />
    </div>
  );
}
