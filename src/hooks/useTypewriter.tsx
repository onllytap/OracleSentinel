import { useState, useEffect, useRef } from 'react';

interface UseTypewriterOptions {
    /** Speed in milliseconds per character (default: 20ms) */
    speed?: number;
    /** Delay before starting (default: 0) */
    startDelay?: number;
    /** Skip animation entirely (useful for already-seen messages) */
    skip?: boolean;
    /** Callback when typing completes */
    onComplete?: () => void;
}

/**
 * Hook for typewriter/streaming text effect
 * Creates a premium typing animation for bot messages
 */
export function useTypewriter(
    text: string,
    options: UseTypewriterOptions = {}
): { displayedText: string; isTyping: boolean; isComplete: boolean } {
    const {
        speed = 20,
        startDelay = 0,
        skip = false,
        onComplete
    } = options;

    const [displayedText, setDisplayedText] = useState(skip ? text : '');
    const [isTyping, setIsTyping] = useState(!skip);
    const [isComplete, setIsComplete] = useState(skip);
    const indexRef = useRef(0);
    const previousTextRef = useRef(text);

    useEffect(() => {
        // If text changed and not skipping, reset
        if (text !== previousTextRef.current) {
            previousTextRef.current = text;
            if (!skip) {
                indexRef.current = 0;
                setDisplayedText('');
                setIsTyping(true);
                setIsComplete(false);
            } else {
                setDisplayedText(text);
            }
        }
    }, [text, skip]);

    useEffect(() => {
        if (skip) {
            setDisplayedText(text);
            setIsTyping(false);
            setIsComplete(true);
            return;
        }

        if (isComplete) return;

        // Start delay
        const startTimeout = setTimeout(() => {
            const typeInterval = setInterval(() => {
                if (indexRef.current < text.length) {
                    // Add characters in small batches for smoother rendering
                    const charsToAdd = Math.min(2, text.length - indexRef.current);
                    indexRef.current += charsToAdd;
                    setDisplayedText(text.slice(0, indexRef.current));
                } else {
                    clearInterval(typeInterval);
                    setIsTyping(false);
                    setIsComplete(true);
                    onComplete?.();
                }
            }, speed);

            return () => clearInterval(typeInterval);
        }, startDelay);

        return () => clearTimeout(startTimeout);
    }, [text, speed, startDelay, skip, isComplete, onComplete]);

    return { displayedText, isTyping, isComplete };
}

/**
 * Simple typing cursor component
 */
export function TypingCursor({ visible }: { visible: boolean }) {
    if (!visible) return null;

    return (
        <span className="inline-block w-0.5 h-4 ml-0.5 bg-gray-600 animate-pulse" />
    );
}
