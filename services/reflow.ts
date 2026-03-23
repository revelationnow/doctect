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
  reflow: boolean
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
    template.elements = template.elements.map(el => reflowElement(el, scaleX, scaleY));
  }

  return result;
}

function reflowElement(el: TemplateElement, scaleX: number, scaleY: number): TemplateElement {
  const scaled: TemplateElement = { ...el };

  // Spatial properties
  scaled.x = round(el.x * scaleX);
  scaled.y = round(el.y * scaleY);
  scaled.w = round(el.w * scaleX);
  scaled.h = round(el.h * scaleY);

  // Typography scaling — use the average of X and Y scale for font size
  const avgScale = (scaleX + scaleY) / 2;
  if (scaled.fontSize != null) {
    scaled.fontSize = Math.max(1, round(scaled.fontSize * avgScale));
  }

  // Stroke width
  if (scaled.strokeWidth != null) {
    scaled.strokeWidth = Math.max(0, round(scaled.strokeWidth * avgScale));
  }

  // Border radius
  if (scaled.borderRadius != null) {
    scaled.borderRadius = Math.max(0, round(scaled.borderRadius * avgScale));
  }

  // Pattern spacing / weight
  if (scaled.patternSpacing != null) {
    scaled.patternSpacing = Math.max(1, round(scaled.patternSpacing * avgScale));
  }
  if (scaled.patternWeight != null) {
    scaled.patternWeight = Math.max(0.5, round(scaled.patternWeight * avgScale));
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
