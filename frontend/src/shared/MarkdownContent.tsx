import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useI18n } from '../i18n';
import './MarkdownContent.css';

/** Render authored prose without enabling raw HTML or changing the stored source. */
export function MarkdownContent({ content, className = '' }: { content: string; className?: string }) {
  const { t } = useI18n();
  return (
    <div className={`rendered-markdown ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children, title }) => href ? (
            <a href={href} title={title} target={/^(https?:)?\/\//i.test(href) ? '_blank' : undefined} rel="noopener noreferrer">{children}</a>
          ) : <span>{children}</span>,
          img: ({ src, alt, title }) => src ? <img src={src} alt={alt ?? ''} title={title} loading="lazy" referrerPolicy="no-referrer" /> : <span>{alt}</span>,
          table: ({ children }) => <div className="markdown-table-scroll" tabIndex={0} role="region" aria-label={t('表格內容')}><table>{children}</table></div>,
        }}
      >{content}</ReactMarkdown>
    </div>
  );
}

/** Non-interactive text for excerpts inside search-result buttons. */
export function MarkdownPreview({ content, className }: { content: string; className?: string }) {
  return (
    <span className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        allowedElements={['br', 'img']}
        unwrapDisallowed
        components={{ img: ({ alt }) => <>{alt}</> }}
      >{content.slice(0, 2000)}</ReactMarkdown>
    </span>
  );
}
