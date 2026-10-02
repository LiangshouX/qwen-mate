import MarkdownBlock from '../../MarkdownBlock';
import CollapsibleTextBlock from '../../CollapsibleTextBlock';
import type { QwenMateContentBlock } from '../../../types';

interface TextBlockProps {
  block: Extract<QwenMateContentBlock, { type: 'text' }>;
  messageType: string;
  isStreaming: boolean;
}

export function TextBlock({ block, messageType, isStreaming }: TextBlockProps) {
  return messageType === 'user' ? (
    <CollapsibleTextBlock content={block.text ?? ''} />
  ) : (
    <MarkdownBlock
      content={block.text ?? ''}
      isStreaming={isStreaming}
    />
  );
}
