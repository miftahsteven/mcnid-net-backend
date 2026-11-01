import sanitizeHtml from 'sanitize-html';

const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+previous\s+instructions?/i,
  /jailbreak/i,
  /forget\s+(everything|all|your\s+instructions?)/i,
  /you\s+are\s+now/i,
  /act\s+as\s+(if\s+you\s+are|a|an)\s+/i,
  /system\s*:/i,
  /\bdan\b.*\bmode\b/i,
];

/**
 * Sanitize HTML input from rich text editors, allowing safe rich formatting and social media embeds
 */
export function sanitizeRichText(input: string): string {
  if (!input) return '';
  return sanitizeHtml(input, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      'img',
      'h1',
      'h2',
      'figure',
      'figcaption',
      'iframe',
      'section',
    ]),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      iframe: [
        'src',
        'width',
        'height',
        'frameborder',
        'allow',
        'allowfullscreen',
        'allowtransparency',
        'scrolling',
        'title',
        'class',
        'style',
        'loading',
        'id',
        'data-*',
      ],
      blockquote: [
        'class',
        'style',
        'cite',
        'data-instgrm-permalink',
        'data-instgrm-version',
        'data-instgrm-captioned',
        'data-video-id',
        'data-se-embed',
        'data-*',
        'id',
      ],
      div: ['class', 'style', 'id', 'data-*', 'data-mcn-embed', 'data-embed-url'],
      section: ['class', 'style', 'id'],
      p: ['class', 'style', 'id', 'align'],
      span: ['class', 'style', 'id'],
      img: ['src', 'alt', 'width', 'height', 'class', 'style', 'id', 'loading'],
      a: ['href', 'target', 'rel', 'title', 'class', 'style', 'id'],
    },
    allowedIframeHostnames: [
      'www.instagram.com',
      'instagram.com',
      'www.tiktok.com',
      'tiktok.com',
      'www.youtube.com',
      'youtube.com',
      'www.youtube-nocookie.com',
      'player.vimeo.com',
      'open.spotify.com',
      'twitter.com',
      'x.com',
      'platform.twitter.com',
      'www.facebook.com',
      'facebook.com',
      'www.google.com',
      'maps.google.com',
    ],
    allowedStyles: {
      '*': {
        'text-align': [/^left$/, /^right$/, /^center$/, /^justify$/],
        'font-size': [/^\d+(?:px|em|rem|%)$/],
        'font-weight': [/^\d+$|^bold$|^normal$|^medium$|^semibold$/],
        'color': [/.+/],
        'background-color': [/.+/],
        'background': [/.+/],
        'margin': [/^(?:auto|0|-?\d+(?:px|em|rem|%)?)(?:\s+(?:auto|0|-?\d+(?:px|em|rem|%)?))*$/],
        'margin-left': [/^(?:auto|0|-?\d+(?:px|em|rem|%)?)$/],
        'margin-right': [/^(?:auto|0|-?\d+(?:px|em|rem|%)?)$/],
        'margin-top': [/^(?:auto|0|-?\d+(?:px|em|rem|%)?)$/],
        'margin-bottom': [/^(?:auto|0|-?\d+(?:px|em|rem|%)?)$/],
        'padding': [/^\d+(?:px|em|rem|%)(?:\s+\d+(?:px|em|rem|%))*$/],
        'width': [/^\d+(?:px|em|rem|%)|calc\(.+\)$/],
        'max-width': [/^\d+(?:px|em|rem|%)|calc\(.+\)$/],
        'min-width': [/^\d+(?:px|em|rem|%)|calc\(.+\)$/],
        'height': [/^\d+(?:px|em|rem|%)$/],
        'border': [/.+/],
        'border-radius': [/^\d+(?:px|em|rem|%)$/],
        'box-shadow': [/.+/],
        'display': [/^flex$/, /^inline-flex$/, /^block$/, /^inline-block$/, /^none$/],
        'justify-content': [/^center$/, /^flex-start$/, /^flex-end$/, /^space-between$/],
        'align-items': [/^center$/, /^flex-start$/, /^flex-end$/],
        'overflow': [/^hidden$/, /^auto$/, /^visible$/, /^scroll$/],
        'clear': [/^both$/, /^left$/, /^right$/],
        'float': [/^left$/, /^right$/, /^none$/],
        'line-height': [/.+/],
        'font-family': [/.+/],
      },
    },
  });
}

/**
 * Strip all HTML from plain text input
 */
export function sanitizePlainText(input: string): string {
  return sanitizeHtml(input, { allowedTags: [], allowedAttributes: {} }).trim();
}

/**
 * Check for prompt injection attempts in chatbot input
 */
export function detectPromptInjection(input: string): boolean {
  return PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(input));
}
