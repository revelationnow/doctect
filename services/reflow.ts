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

  // Typography scaling — use the average of X and Y scale for font size
  if (scaleFontSize) {
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
