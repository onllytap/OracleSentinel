import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "../../components/ui/utils";

/**
 * FlipWords — animated rotating words (Aceternity-style, reimplemented).
 * Cycles through a list of words with a smooth blur/slide transition.
 */
export function FlipWords({
  words,
  duration = 2600,
  className,
}: {
  words: string[];
  duration?: number;
  className?: string;
}) {
  const [index, setIndex] = useState(0);

  const next = useCallback(() => {
    setIndex((i) => (i + 1) % words.length);
  }, [words.length]);

  useEffect(() => {
    const t = setInterval(next, duration);
    return () => clearInterval(t);
  }, [next, duration]);

  return (
    <AnimatePresence mode="wait">
      <motion.span
        key={words[index]}
        initial={{ opacity: 0, y: 8, filter: "blur(6px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        exit={{ opacity: 0, y: -8, filter: "blur(6px)", position: "absolute" }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        className={cn("inline-block bg-gradient-to-r from-primary to-sky-400 bg-clip-text text-transparent", className)}
      >
        {words[index]}
      </motion.span>
    </AnimatePresence>
  );
}
