import type {
  SelectionChildrenPage,
  SelectionCommand,
  SelectionElementContext,
  SelectionElementEvidence,
  SelectionEvidence,
  SelectionRect,
} from '@atoms-demo/core/selection'
import {
  SELECTION_LIMITS,
  SELECTION_PROTOCOL,
  SELECTION_PROTOCOL_VERSION,
  SELECTION_SOURCE_ATTRIBUTE,
} from '@atoms-demo/core/selection'

export interface PreviewSelectionConfig {
  sessionId: string
  editorOrigin: string
}

/** This function is serialized: all frame code and state must remain inside it. */
function installRuntime(
  config: PreviewSelectionConfig,
  protocol: string,
  protocolVersion: number,
  sourceAttribute: string,
  limits: typeof SELECTION_LIMITS,
) {
  let enabled = false
  let disposed = false
  let selected: Element | null = null
  let hovered: Element | null = null
  let sequence = 0
  let revision = 0
  let scheduled = 0
  let gesture = false
  let nodesChanged = false
  let cancelled = false
  let overlay: HTMLDivElement | null = null
  let drawing: ShadowRoot | null = null
  let lastDrawing = ''
  let topLayerChanged = true
  const identities = new WeakMap<Element, string>()
  const nodes = new Map<string, WeakRef<Element>>()
  const observed = new WeakSet<Node>()
  const cleanups: (() => void)[] = []
  const technical: Record<string, true> = {
    script: true,
    style: true,
    link: true,
    meta: true,
    head: true,
    title: true,
    template: true,
    noscript: true,
  }
  const attributes = [
    'id',
    'class',
    'role',
    'aria-label',
    'aria-labelledby',
    'aria-describedby',
    'aria-expanded',
    'aria-selected',
    'aria-checked',
    'aria-disabled',
    'alt',
    'title',
    'type',
    'placeholder',
  ]
  const styles = [
    'display',
    'visibility',
    'position',
    'color',
    'background-color',
    'font-family',
    'font-size',
    'font-weight',
    'line-height',
    'text-align',
    'border-radius',
    'padding',
    'gap',
    'opacity',
  ]
  const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength
  const bounded = (value: string | null, length: number) => (value ?? '').slice(0, length)
  const tag = (element: Element) =>
    element.localName.toLowerCase().slice(0, limits.attributeCharacters)
  const usable = (element: Element) =>
    element !== overlay && !Object.hasOwn(technical, tag(element))
  const rect = (value: DOMRect): SelectionRect => ({
    x: value.x,
    y: value.y,
    width: value.width,
    height: value.height,
  })
  function send(type: string, payload: unknown, requestId: string | null = null) {
    const message = {
      protocol,
      protocolVersion,
      sessionId: config.sessionId,
      requestId,
      type,
      payload,
    }
    if (bytes(message) > limits.metadataBytes) throw new Error('metadata-too-large')
    parent.postMessage(message, config.editorOrigin)
  }
  function id(element: Element) {
    let value = identities.get(element)
    if (!value) {
      value = `n${++sequence}`
      identities.set(element, value)
      nodes.set(value, new WeakRef(element))
    }
    return value
  }
  function resolve(value: string) {
    const element = nodes.get(value)?.deref()
    if (!element?.isConnected || !usable(element)) throw new Error('node-missing')
    return element
  }
  function parentElement(element: Element): Element | null {
    if (element.assignedSlot) return element.assignedSlot
    if (element.parentElement) return element.parentElement
    const root = element.getRootNode()
    return root instanceof ShadowRoot ? root.host : null
  }
  function listen(target: EventTarget, type: string, callback: EventListener, passive = false) {
    target.addEventListener(type, callback, { capture: true, passive })
    cleanups.push(() => target.removeEventListener(type, callback, true))
  }
  function observe(root: Node) {
    if (observed.has(root)) return
    observed.add(root)
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    })
    if (root instanceof ShadowRoot) listen(root, 'scroll', schedule, true)
  }
  function children(element: Element): Element[] {
    if (['iframe', 'canvas', 'object', 'embed'].includes(tag(element))) return []
    if (element.shadowRoot) {
      observe(element.shadowRoot)
      return Array.from(element.shadowRoot.children).filter(usable)
    }
    if (element instanceof HTMLSlotElement) {
      const assigned = element.assignedElements({ flatten: true })
      if (assigned.length) return assigned.filter(usable)
    }
    return Array.from(element.children).filter(usable)
  }
  function hidden(element: Element) {
    const style = getComputedStyle(element)
    return (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse' ||
      element.getClientRects().length === 0
    )
  }
  function text(element: Element, maximum: number = limits.textCharacters) {
    let result = ''
    let visited = 0
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (
            node instanceof Element &&
            (!usable(node) || ['input', 'textarea', 'select'].includes(tag(node)))
          )
            return NodeFilter.FILTER_REJECT
          return node.nodeType === Node.TEXT_NODE
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_SKIP
        },
      },
    )
    if (['input', 'textarea', 'select'].includes(tag(element))) return ''
    while (result.length < maximum && visited++ < 4000) {
      const next = walker.nextNode()
      if (!next) break
      result += bounded(next.textContent, maximum - result.length)
    }
    return result.replace(/\s+/g, ' ').trim().slice(0, maximum)
  }
  function label(element: Element) {
    return bounded(
      element.getAttribute('aria-label') ||
        element.getAttribute('alt') ||
        text(element, 160) ||
        element.getAttribute('title') ||
        tag(element),
      160,
    )
  }
  function sourceId(element: Element) {
    return element.hasAttribute(sourceAttribute)
      ? bounded(element.getAttribute(sourceAttribute), limits.attributeCharacters)
      : null
  }
  function context(element: Element): SelectionElementContext {
    const ancestry: SelectionElementContext['ancestors'] = []
    let ancestor = parentElement(element)
    while (ancestor && ancestry.length < limits.ancestors) {
      if (usable(ancestor))
        ancestry.push({
          nodeId: id(ancestor),
          sourceId: sourceId(ancestor),
          tagName: tag(ancestor),
          label: label(ancestor),
        })
      ancestor = parentElement(ancestor)
    }
    const attrs: Record<string, string> = {}
    // Password labels remain useful; no value/property or arbitrary data attributes are read.
    for (const name of attributes) {
      const value = element.getAttribute(name)
      if (value !== null) attrs[name] = bounded(value, limits.attributeCharacters)
    }
    const computed = getComputedStyle(element)
    const style: Record<string, string> = {}
    for (const name of styles) style[name] = bounded(computed.getPropertyValue(name), 160)
    let selector = tag(element)
    if (element.id) selector += `#${CSS.escape(element.id)}`
    else if (element.getAttribute('aria-label')) {
      selector += `[aria-label="${CSS.escape(element.getAttribute('aria-label') ?? '')}"]`
    } else if (element.getAttribute('role')) {
      selector += `[role="${CSS.escape(element.getAttribute('role') ?? '')}"]`
    }
    const result: SelectionElementContext = {
      nodeId: id(element),
      sourceId: sourceId(element),
      tagName: tag(element),
      role: element.getAttribute('role')?.slice(0, limits.attributeCharacters) ?? null,
      text: text(element),
      attributes: attrs,
      styles: style,
      selector: bounded(selector, limits.selectorCharacters),
      ancestors: ancestry,
      rects: Array.from(element.getClientRects()).slice(0, limits.rects).map(rect),
      viewport: { width: innerWidth, height: innerHeight },
      scroll: { x: scrollX, y: scrollY },
      instance: {
        label: label(element),
        context: bounded(ancestry.map((item) => item.label).join(' / '), limits.instanceCharacters),
      },
    }
    // Preserve identity and geometry first when long Unicode fields exhaust the wire budget.
    while (bytes(result) > limits.metadataBytes - 1024 && result.ancestors.length)
      result.ancestors.pop()
    for (const name of [...attributes].reverse()) {
      if (bytes(result) <= limits.metadataBytes - 1024) break
      delete result.attributes[name]
    }
    return result
  }
  function evidence(element: Element): SelectionElementEvidence {
    return { kind: 'element', element: context(element) }
  }
  function choose(element: Element) {
    selected = element
    const value = evidence(element)
    send('selected', value)
    schedule()
    return value
  }
  function clear() {
    selected = null
    hovered = null
    send('cleared', null)
    schedule()
    return null
  }
  function draw() {
    scheduled = 0
    if (disposed) return
    if (nodesChanged) {
      nodesChanged = false
      for (const [nodeId, reference] of nodes) {
        const element = reference.deref()
        if (!element?.isConnected) {
          nodes.delete(nodeId)
          if (element) identities.delete(element)
          send('invalidated', { nodeId })
          if (element === selected) selected = null
          if (element === hovered) hovered = null
        }
      }
    }
    if (!enabled || (!selected && !hovered)) {
      overlay?.remove()
      overlay = null
      drawing = null
      lastDrawing = ''
      return
    }
    if (!overlay) {
      overlay = document.createElement('div')
      overlay.setAttribute('aria-hidden', 'true')
      overlay.setAttribute('popover', 'manual')
      overlay.style.cssText =
        'all:initial!important;position:fixed!important;inset:0!important;' +
        'width:100vw!important;height:100vh!important;margin:0!important;border:0!important;' +
        'padding:0!important;background:transparent!important;pointer-events:none!important;' +
        'overflow:visible!important;z-index:2147483647!important;'
      drawing = overlay.attachShadow({ mode: 'closed' })
      document.documentElement.append(overlay)
    }
    // A manual popover participates in the top layer above modal dialogs and popovers.
    if (
      typeof overlay.showPopover === 'function' &&
      (topLayerChanged || !overlay.matches(':popover-open'))
    ) {
      if (overlay.matches(':popover-open')) overlay.hidePopover()
      overlay.showPopover()
      topLayerChanged = false
    }
    const fragments: { box: SelectionRect; active: boolean }[] = []
    for (const element of new Set([selected, hovered])) {
      if (!element?.isConnected) continue
      for (const box of Array.from(element.getClientRects()).slice(0, limits.rects)) {
        fragments.push({ box: rect(box), active: element === selected })
      }
    }
    const signature = JSON.stringify(fragments)
    if (signature !== lastDrawing) {
      lastDrawing = signature
      drawing?.replaceChildren()
      for (const { box, active } of fragments) {
        const outline = document.createElement('div')
        outline.style.cssText =
          `position:fixed;pointer-events:none;box-sizing:border-box;` +
          `left:${box.x}px;top:${box.y}px;width:${box.width}px;height:${box.height}px;` +
          `border:2px ${active ? 'solid' : 'dashed'} #0284c7;`
        drawing?.append(outline)
      }
    }
    // Geometry follows animations and transforms without scanning the application tree.
    scheduled = requestAnimationFrame(draw)
  }
  function schedule() {
    if (!scheduled && !disposed) scheduled = requestAnimationFrame(draw)
  }
  const observer = new MutationObserver((records) => {
    if (
      records.some(
        (record) =>
          record.target !== overlay &&
          !(
            record.type === 'childList' &&
            [...record.addedNodes, ...record.removedNodes].every((node) => node === overlay)
          ),
      )
    ) {
      revision++
      nodesChanged = true
      schedule()
    }
  })
  observe(document)
  function list(
    payload: Extract<SelectionCommand, { type: 'children' }>['payload'],
  ): SelectionChildrenPage {
    const root = payload.parentNodeId === null ? document.body : resolve(payload.parentNodeId)
    const items = root ? children(root) : []
    let offset = 0
    if (payload.cursor) {
      const match = /^(\d+):(\d+):(.*)$/.exec(payload.cursor)
      const key = `${payload.parentNodeId ?? ''}:${payload.includeHidden === true}`
      if (!match || Number(match[1]) !== revision || match[3] !== key)
        throw new Error('cursor-stale')
      offset = Number(match[2])
      if (!Number.isSafeInteger(offset) || offset > items.length) throw new Error('cursor-invalid')
    }
    const page: SelectionChildrenPage = {
      parentNodeId: payload.parentNodeId,
      children: [],
      nextCursor: null,
    }
    for (; offset < items.length; offset++) {
      const element = items[offset]
      if (!element) continue
      const isHidden = hidden(element)
      if (isHidden && !payload.includeHidden) continue
      const row = {
        nodeId: id(element),
        tagName: tag(element),
        label: label(element),
        sourceId: sourceId(element),
        hasChildren: children(element).length > 0,
        hidden: isHidden,
      }
      page.children.push(row)
      if (bytes(page) > limits.metadataBytes - 1024) {
        page.children.pop()
        break
      }
      if (page.children.length === limits.children) {
        offset++
        break
      }
    }
    if (offset < items.length) {
      page.nextCursor = `${revision}:${offset}:${payload.parentNodeId ?? ''}:${payload.includeHidden === true}`
    }
    return page
  }
  function region(rectangle: SelectionRect, focusNodeId?: string | null): SelectionEvidence {
    const result: Extract<SelectionEvidence, { kind: 'region' }> = {
      kind: 'region',
      rectangle,
      elements: [],
      focus: focusNodeId ? context(resolve(focusNodeId)) : null,
      viewport: { width: innerWidth, height: innerHeight },
      scroll: { x: scrollX, y: scrollY },
      truncated: false,
    }
    // Positive-area intersections only. Deepest rendered descendants win over their ancestors;
    // overlapping siblings both remain, in composed-tree order. Offscreen/hidden boxes are excluded.
    const intersects = (element: Element) =>
      !hidden(element) &&
      Array.from(element.getClientRects()).some(
        (box) =>
          Math.max(box.left, rectangle.x, 0) <
            Math.min(box.right, rectangle.x + rectangle.width, innerWidth) &&
          Math.max(box.top, rectangle.y, 0) <
            Math.min(box.bottom, rectangle.y + rectangle.height, innerHeight),
      )
    const stack: { element: Element; expanded: boolean }[] = document.body
      ? [{ element: document.body, expanded: false }]
      : []
    const covered = new WeakSet<Element>()
    let visited = 0
    while (stack.length) {
      const entry = stack.pop()
      if (!entry) break
      const { element, expanded } = entry
      if (!expanded) {
        if (++visited > 20000) {
          result.truncated = true
          break
        }
        stack.push({ element, expanded: true })
        const descendants = children(element)
        for (let index = descendants.length - 1; index >= 0; index--) {
          const child = descendants[index]
          if (child) stack.push({ element: child, expanded: false })
        }
        continue
      }
      const hit = intersects(element)
      if (hit && !covered.has(element)) {
        if (result.elements.length < limits.regionMembers) {
          result.elements.push(context(element))
          if (bytes(result) > limits.metadataBytes - 1024) {
            result.elements.pop()
            result.truncated = true
          }
        } else result.truncated = true
      }
      if (hit || covered.has(element)) {
        const ancestor = parentElement(element)
        if (ancestor) covered.add(ancestor)
      }
    }
    return result
  }
  function dispose() {
    disposed = true
    enabled = false
    observer.disconnect()
    for (const cleanup of cleanups.splice(0)) cleanup()
    cancelAnimationFrame(scheduled)
    overlay?.remove()
    nodes.clear()
    selected = null
    hovered = null
  }
  function target(event: Event) {
    for (const item of event.composedPath()) {
      if (item instanceof Element && usable(item)) {
        const root = item.getRootNode()
        if (root instanceof ShadowRoot) observe(root)
        return item
      }
    }
    return null
  }
  function overlapTarget(event: MouseEvent) {
    const hits: Element[] = []
    const seen = new Set<Element>()
    function collect(root: Document | ShadowRoot) {
      for (const element of root.elementsFromPoint(event.clientX, event.clientY)) {
        if (!usable(element) || seen.has(element)) continue
        seen.add(element)
        if (element.shadowRoot) collect(element.shadowRoot)
        hits.push(element)
      }
    }
    collect(document)
    const ancestors = new Set<Element>()
    for (const element of hits) {
      let ancestor = parentElement(element)
      while (ancestor) {
        ancestors.add(ancestor)
        ancestor = parentElement(ancestor)
      }
    }
    const targets = hits.filter((element) => !ancestors.has(element))
    const index = selected ? targets.indexOf(selected) : -1
    return targets[(index + 1) % targets.length] ?? target(event)
  }
  function intercept(event: Event) {
    if (!enabled && event.type === 'pointerdown' && !gesture) cancelled = false
    if (!enabled && !gesture && !cancelled) return
    if (event.type === 'pointerdown') {
      gesture = true
      cancelled = false
    }
    if (event.type === 'pointercancel') {
      gesture = false
      cancelled = true
    }
    event.stopImmediatePropagation()
    // Let native touch panning and wheel scrolling continue while blocking app listeners.
    if (!event.type.startsWith('touch') && event.cancelable) event.preventDefault()
    if (event.type === 'click') {
      const element =
        event instanceof MouseEvent && event.altKey ? overlapTarget(event) : target(event)
      if (enabled && !cancelled && element) choose(element)
      gesture = false
      cancelled = false
    }
  }
  for (const type of [
    'pointerdown',
    'pointerup',
    'pointercancel',
    'mousedown',
    'mouseup',
    'click',
    'dblclick',
    'auxclick',
    'contextmenu',
    'dragstart',
    'touchstart',
    'touchend',
    'touchcancel',
    'touchmove',
  ]) {
    listen(window, type, intercept)
  }
  listen(window, 'pointermove', (event) => {
    if (!enabled) return
    hovered = target(event)
    event.stopImmediatePropagation()
    schedule()
  })
  listen(window, 'mousemove', (event) => {
    if (enabled) event.stopImmediatePropagation()
  })
  listen(window, 'keydown', (event) => {
    if (!enabled || !(event instanceof KeyboardEvent)) return
    event.stopImmediatePropagation()
    if (['Escape', 'Enter', ' ', 'ArrowUp'].includes(event.key)) {
      event.preventDefault()
      if (event.key === 'Escape') clear()
      else if (event.key === 'ArrowUp' && selected) {
        const ancestor = parentElement(selected)
        if (ancestor) choose(ancestor)
      } else {
        const focused = target(event)
        const candidate =
          focused && !['html', 'body'].includes(tag(focused)) ? focused : hovered || selected
        if (candidate) choose(candidate)
      }
    }
  })
  listen(window, 'keyup', (event) => {
    if (enabled) {
      event.stopImmediatePropagation()
      event.preventDefault()
    }
  })
  for (const type of ['beforetoggle', 'toggle']) {
    listen(window, type, (event) => {
      if (event.target === overlay) event.stopImmediatePropagation()
      else {
        topLayerChanged = true
        schedule()
      }
    })
  }
  listen(window, 'scroll', schedule, true)
  listen(window, 'resize', schedule, true)
  if (visualViewport) {
    listen(visualViewport, 'scroll', schedule, true)
    listen(visualViewport, 'resize', schedule, true)
  }
  function validCommand(value: unknown): value is SelectionCommand {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    // The portable frame has no schema-library dependency. Narrow every command field here.
    const message = value as Record<string, unknown>
    if (
      message.protocol !== protocol ||
      message.protocolVersion !== protocolVersion ||
      message.sessionId !== config.sessionId ||
      typeof message.requestId !== 'string' ||
      message.requestId.length > 200 ||
      !message.requestId ||
      !message.payload ||
      typeof message.payload !== 'object' ||
      Array.isArray(message.payload)
    )
      return false
    const payload = message.payload as Record<string, unknown>
    switch (message.type) {
      case 'enable':
        return typeof payload.enabled === 'boolean'
      case 'select':
        return typeof payload.nodeId === 'string' && payload.nodeId.length <= 200
      case 'hover':
        return (
          payload.nodeId === null ||
          (typeof payload.nodeId === 'string' && payload.nodeId.length <= 200)
        )
      case 'children':
        return (
          (payload.parentNodeId === null || typeof payload.parentNodeId === 'string') &&
          (payload.cursor == null || typeof payload.cursor === 'string') &&
          (payload.includeHidden === undefined || typeof payload.includeHidden === 'boolean')
        )
      case 'capture': {
        if (payload.focusNodeId != null && typeof payload.focusNodeId !== 'string') return false
        if (payload.region === undefined) return true
        if (!payload.region || typeof payload.region !== 'object') return false
        const box = payload.region as Record<string, unknown>
        return (
          typeof box.x === 'number' &&
          Number.isFinite(box.x) &&
          typeof box.y === 'number' &&
          Number.isFinite(box.y) &&
          typeof box.width === 'number' &&
          Number.isFinite(box.width) &&
          box.width > 0 &&
          typeof box.height === 'number' &&
          Number.isFinite(box.height) &&
          box.height > 0
        )
      }
      case 'parent':
      case 'clear':
      case 'dispose':
        return Object.keys(payload).length === 0
      default:
        return false
    }
  }
  listen(window, 'message', (event) => {
    if (
      !(event instanceof MessageEvent) ||
      event.source !== parent ||
      event.origin !== config.editorOrigin
    )
      return
    try {
      if (bytes(event.data) > limits.metadataBytes) return
    } catch {
      return
    }
    if (!validCommand(event.data)) return
    const message = event.data
    try {
      let value: unknown = null
      switch (message.type) {
        case 'enable':
          enabled = message.payload.enabled
          hovered = null
          value = { enabled }
          send('ready', value)
          cancelAnimationFrame(scheduled)
          draw()
          break
        case 'children':
          value = list(message.payload)
          break
        case 'select':
          value = choose(resolve(message.payload.nodeId))
          break
        case 'hover':
          hovered = message.payload.nodeId ? resolve(message.payload.nodeId) : null
          schedule()
          break
        case 'parent': {
          const ancestor = selected ? parentElement(selected) : null
          value = ancestor ? choose(ancestor) : null
          break
        }
        case 'capture':
          value = message.payload.region
            ? region(message.payload.region, message.payload.focusNodeId)
            : selected?.isConnected
              ? evidence(selected)
              : null
          break
        case 'clear':
          value = clear()
          break
        case 'dispose':
          dispose()
          break
      }
      send('result', { command: message.type, value }, message.requestId)
    } catch (error) {
      send(
        'error',
        {
          code: error instanceof Error ? error.message : 'runtime-error',
          message: 'Selection command failed',
        },
        message.requestId,
      )
    }
  })
  listen(window, 'pagehide', () => {
    send('error', { code: 'document-replaced', message: 'Preview document replaced' })
    dispose()
  })
  send('ready', { enabled })
}

/** Insert before application scripts; the runtime begins disabled and never reloads on enable. */
export function createPreviewSelectionScript(config: PreviewSelectionConfig): string {
  const origin = new URL(config.editorOrigin)
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.origin !== config.editorOrigin ||
    !config.sessionId ||
    config.sessionId.length > 200
  )
    throw new Error('invalid-selection-config')
  const args = JSON.stringify([
    config,
    SELECTION_PROTOCOL,
    SELECTION_PROTOCOL_VERSION,
    SELECTION_SOURCE_ATTRIBUTE,
    SELECTION_LIMITS,
  ]).replace(/</g, '\\u003c')
  return `;(${installRuntime.toString()})(...${args});`
}

export function injectPreviewSelectionRuntime(
  html: string,
  config: PreviewSelectionConfig,
): string {
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html)
  const prefix = doctype?.[0] ?? '<!doctype html>'
  return `${prefix}<script>${createPreviewSelectionScript(config)}</script>${html.slice(doctype?.[0].length ?? 0)}`
}
