import { PageTemplate, TemplateElement } from '../types';

/**
 * Deep-copy templates and optionally reflow elements to fit new page dimensions.
 *
 * @param sourceTemplates - The templates to copy from
 * @param targetWidth - Desired page width (only used when reflow = true)
 * @param targetHeight - Desired page height (only used when reflow = true)
 * @param reflow - If true, scale elements proportionally and update page dimensions.
 *                 If false, return a pure deep copy with no changes.
 */
export function reflowTemplates(
  sourceTemplates: Record<string, PageTemplate>,
  targetWidth: number,
  targetHeight: number,
  reflow: boolean,
  scaleFontSize: boolean = true
): Record<string, PageTemplate> {
  // Deep copy
  const result: Record<string, PageTemplate> = JSON.parse(JSON.stringify(sourceTemplates));

  for (const templateId of Object.keys(result)) {
    const template = result[templateId];
    const oldW = template.width;
    const oldH = template.height;

    // Update page dimensions always
    template.width = targetWidth;
    template.height = targetHeight;

    // Skip if dimensions are already the same or if reflow is disabled
    if (!reflow || (oldW === targetWidth && oldH === targetHeight)) continue;

    const scaleX = targetWidth / oldW;
    const scaleY = targetHeight / oldH;

    // Scale every element
    template.elements = template.elements.map(el => reflowElement(el, scaleX, scaleY, scaleFontSize));
  }

  return result;
}

function reflowElement(el: TemplateElement, scaleX: number, scaleY: number, scaleFontSize: boolean): TemplateElement {
  const scaled: TemplateElement = { ...el };

  // Spatial properties (accounting for rotation)
  const rad = (el.rotation || 0) * (Math.PI / 180);

  // Projection of the element's local axes onto the page axes
  const localScaleX = Math.sqrt(
    Math.pow(Math.cos(rad) * scaleX, 2) + Math.pow(Math.sin(rad) * scaleY, 2)
  );
  const localScaleY = Math.sqrt(
    Math.pow(Math.sin(rad) * scaleX, 2) + Math.pow(Math.cos(rad) * scaleY, 2)
  );

  scaled.w = round(el.w * localScaleX);
  scaled.h = round(el.h * localScaleY);

  // Compute original center and scale it
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  
  const newCx = cx * scaleX;
  const newCy = cy * scaleY;

  // Derive new top-left from the scaled center and new scaled bounds
  scaled.x = round(newCx - scaled.w / 2);
  scaled.y = round(newCy - scaled.h / 2);

  // Typography scaling
  if (scaleFontSize) {
    const avgScale = (localScaleX + localScaleY) / 2;

    if (scaled.fontSize != null) {
      if (el.text || el.dataBinding) {
        const textToMeasure = el.text || (el.dataBinding ? `{{${el.dataBinding}}}` : "Sample");
        scaled.fontSize = calculateProportionalFontSize(
          textToMeasure,
          el.fontFamily || 'Inter',
          el.w,
          el.h,
          scaled.w,
          scaled.h,
          Number(el.fontSize) || 12
        );
      } else {
        scaled.fontSize = Math.max(1, round(scaled.fontSize * avgScale));
      }
    }

    // Stroke width
    if (scaled.strokeWidth != null) {
      scaled.strokeWidth = Math.max(0, round(scaled.strokeWidth * avgScale));
    }

    // Border radius
    if (scaled.borderRadius != null) {
      scaled.borderRadius = Math.max(0, round(scaled.borderRadius * avgScale));
    }
  }

  // Pattern spacing / weight
  if (scaled.patternSpacing != null || scaled.patternWeight != null) {
    let patternScale = (localScaleX + localScaleY) / 2;
    if (scaled.patternType === 'lines-h' || scaled.patternType === 'dots') {
      patternScale = localScaleY;
    } else if (scaled.patternType === 'lines-v') {
      patternScale = localScaleX;
    }

    if (scaled.patternSpacing != null) {
      scaled.patternSpacing = Math.max(1, round(scaled.patternSpacing * patternScale));
    }
    if (scaled.patternWeight != null) {
      scaled.patternWeight = Math.max(0.5, round(scaled.patternWeight * patternScale));
    }
  }

  // Grid config gaps
  if (scaled.gridConfig) {
    scaled.gridConfig = { ...scaled.gridConfig };
    scaled.gridConfig.gapX = round(scaled.gridConfig.gapX * scaleX);
    scaled.gridConfig.gapY = round(scaled.gridConfig.gapY * scaleY);
  }

  return scaled;
}

/** Round to 2 decimal places */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 
 * Uses an HTML5 Canvas to strictly calculate exact wrapped pixel boundaries.
 * Isolates the precise fontSize required to maintain equivalent visual spacing limits inside the newly scaled container.
 */
function calculateProportionalFontSize(
  text: string,
  fontFamily: string,
  oldW: number,
  oldH: number,
  newW: number,
  newH: number,
  oldFontSize: number
): number {
  if (typeof document === 'undefined') return oldFontSize * ((newW / oldW + newH / oldH) / 2);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx || !text || oldW === 0 || oldH === 0) return oldFontSize * ((newW / oldW + newH / oldH) / 2);

  const measure = (size: number, boxW: number) => {
    ctx.font = `${size}px "${fontFamily}", sans-serif`;
    const lines = text.split('\n');
    let totalLines = 0;
    let maxLineWidth = 0;
    for (const paragraph of lines) {
      if (!paragraph) { totalLines++; continue; }
      const words = paragraph.split(' ');
      let currentLine = words[0] || '';
      totalLines++;
      for (let j = 1; j < words.length; j++) {
        const word = words[j];
        if (ctx.measureText(currentLine + " " + word).width <= boxW) {
          currentLine += " " + word;
        } else {
          maxLineWidth = Math.max(maxLineWidth, ctx.measureText(currentLine).width);
          currentLine = word;
          totalLines++;
        }
      }
      maxLineWidth = Math.max(maxLineWidth, ctx.measureText(currentLine).width);
    }
    return { w: maxLineWidth, h: totalLines * (size * 1.2) };
  };

  const oldMetrics = measure(oldFontSize, oldW);
  if (oldMetrics.w === 0 || oldMetrics.h === 0) {
    return oldFontSize * ((newW / oldW + newH / oldH) / 2);
  }

  const targetTextW = oldMetrics.w * (newW / oldW);
  const targetTextH = oldMetrics.h * (newH / oldH);
  const targetArea = targetTextW * targetTextH;

  let low = 1;
  let high = 500;
  let bestSize = oldFontSize * ((newW / oldW + newH / oldH) / 2);

  for (let i = 0; i < 15; i++) {
    const mid = (low + high) / 2;
    const m = measure(mid, newW);
    const currentArea = m.w * m.h;
    
    // Find highest threshold that bounds strictly within the expected area density
    if (currentArea <= targetArea && m.w <= newW && m.h <= newH) {
      bestSize = mid;
      low = mid;
    } else {
      high = mid;
    }
  }

  return Math.max(1, Math.round(bestSize * 10) / 10);
}
