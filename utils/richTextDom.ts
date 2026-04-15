import {
  createHtmlSource,
  createPlainTextSource,
  hasMeaningfulHtml,
  stripHtmlToPlainText,
  type TranslationSourcePayload,
} from './richText'

const ALLOWED_TAGS = new Set([
  'a',
  'blockquote',
  'br',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'ol',
  'p',
  'strong',
  'ul',
])

const PARAGRAPH_LIKE_TAGS = new Set([
  'address',
  'article',
  'aside',
  'dd',
  'details',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'header',
  'main',
  'nav',
  'p',
  'section',
])

const DROP_TAGS = new Set([
  'audio',
  'button',
  'canvas',
  'form',
  'iframe',
  'img',
  'input',
  'noscript',
  'object',
  'script',
  'select',
  'style',
  'svg',
  'textarea',
  'video',
])

const LIST_CONTAINER_TAGS = new Set(['ol', 'ul'])
const BLOCK_TAGS = new Set(['blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ol', 'p', 'ul'])

const isSafeHref = (value: string): boolean => {
  const trimmed = value.trim()
  return /^(https?:|mailto:)/iu.test(trimmed)
}

const isWhitespaceTextNode = (node: Node): boolean =>
  node.nodeType === Node.TEXT_NODE && !(node.textContent ?? '').trim()

const hasBlockNodes = (nodes: Node[]): boolean =>
  nodes.some(node => {
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return false
    }

    const tagName = (node as HTMLElement).tagName.toLowerCase()
    return BLOCK_TAGS.has(tagName)
  })

const appendChildren = (target: HTMLElement, children: Node[]): void => {
  children.forEach(child => target.appendChild(child))
}

const sanitizeNode = (node: Node, doc: Document): Node[] => {
  if (node.nodeType === Node.TEXT_NODE) {
    const value = node.textContent ?? ''
    return value ? [doc.createTextNode(value)] : []
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return []
  }

  const element = node as HTMLElement
  const tagName = element.tagName.toLowerCase()

  if (DROP_TAGS.has(tagName)) {
    return []
  }

  if (tagName === 'br') {
    return [doc.createElement('br')]
  }

  const sanitizedChildren = Array.from(element.childNodes).flatMap(child => sanitizeNode(child, doc))

  if (tagName === 'b') {
    const strong = doc.createElement('strong')
    appendChildren(strong, sanitizedChildren)
    return strong.textContent?.trim() ? [strong] : []
  }

  if (tagName === 'i') {
    const em = doc.createElement('em')
    appendChildren(em, sanitizedChildren)
    return em.textContent?.trim() ? [em] : []
  }

  if (ALLOWED_TAGS.has(tagName)) {
    const allowedElement = doc.createElement(tagName)

    if (tagName === 'a') {
      const href = element.getAttribute('href')
      if (href && isSafeHref(href)) {
        allowedElement.setAttribute('href', href.trim())
      }
    }

    appendChildren(allowedElement, sanitizedChildren)
    return allowedElement.tagName.toLowerCase() === 'br' || allowedElement.textContent?.trim()
      ? [allowedElement]
      : []
  }

  if (LIST_CONTAINER_TAGS.has(tagName)) {
    const listElement = doc.createElement(tagName)
    sanitizedChildren.forEach(child => {
      if (child.nodeType === Node.ELEMENT_NODE && (child as HTMLElement).tagName.toLowerCase() === 'li') {
        listElement.appendChild(child)
      }
    })

    return listElement.childNodes.length > 0 ? [listElement] : []
  }

  if (PARAGRAPH_LIKE_TAGS.has(tagName)) {
    if (sanitizedChildren.length === 0) {
      return []
    }

    if (hasBlockNodes(sanitizedChildren)) {
      return sanitizedChildren.filter(child => !(child.nodeType === Node.TEXT_NODE && !(child.textContent ?? '').trim()))
    }

    const paragraph = doc.createElement('p')
    appendChildren(paragraph, sanitizedChildren)
    return paragraph.textContent?.trim() ? [paragraph] : []
  }

  return sanitizedChildren
}

const cleanupFragment = (fragment: DocumentFragment): void => {
  const childNodes = Array.from(fragment.childNodes)

  childNodes.forEach(node => {
    if (isWhitespaceTextNode(node)) {
      fragment.removeChild(node)
    }
  })
}

const serializeFragment = (doc: Document, nodes: Node[]): string => {
  const container = doc.createElement('div')
  nodes.forEach(node => container.appendChild(node))
  return container.innerHTML.trim()
}

/**
 * Sanitizes HTML into a small semantic allowlist so the translated dialog can
 * safely render common rich text without inheriting host-page styling or code.
 */
export const sanitizeRichTextHtml = (value: string): string => {
  const doc = document.implementation.createHTMLDocument('')
  const parser = new DOMParser()
  const parsed = parser.parseFromString(value, 'text/html')
  const sanitizedNodes = Array.from(parsed.body.childNodes).flatMap(node => sanitizeNode(node, doc))
  const fragment = doc.createDocumentFragment()
  sanitizedNodes.forEach(node => fragment.appendChild(node))
  cleanupFragment(fragment)
  return serializeFragment(doc, Array.from(fragment.childNodes))
}

/**
 * Clones the active DOM selection, converts it into a sanitized semantic HTML
 * fragment, and keeps a plain-text fallback for providers or UI flows that do
 * not support rich rendering.
 */
export const extractFormattedSelection = (
  selection: Selection | null,
): TranslationSourcePayload | null => {
  const plainText = selection?.toString().trim() ?? ''

  if (!selection || selection.rangeCount === 0 || !plainText) {
    return null
  }

  const range = selection.getRangeAt(0)
  const fragment = range.cloneContents()
  const container = document.createElement('div')
  container.appendChild(fragment)
  const sanitizedHtml = sanitizeRichTextHtml(container.innerHTML)

  if (!hasMeaningfulHtml(sanitizedHtml)) {
    return createPlainTextSource(plainText)
  }

  const normalizedPlainText = stripHtmlToPlainText(sanitizedHtml) || plainText
  return createHtmlSource(normalizedPlainText, sanitizedHtml)
}
