import type { Design, DesignElement, EditableProps, PageConfig } from '@payslip/types';
import { createElement } from '@payslip/model/factory';

type ElementSpec = Partial<Omit<EditableProps, 'id' | 'type'>> & { type: DesignElement['type'] };

/**
 * A tiny DSL for authoring templates: `add(spec)` starts from the factory
 * defaults for the element type, then applies the spec overrides.
 */
export class TemplateBuilder {
  private z = 1;
  private readonly elements: DesignElement[] = [];

  constructor(private readonly page: PageConfig) {}

  add(spec: ElementSpec): this {
    const base = createElement(spec.type, spec.x ?? 0, spec.y ?? 0, this.z++);
    this.elements.push({ ...base, ...spec } as DesignElement);
    return this;
  }

  build(): Design {
    return { page: this.page, elements: this.elements };
  }
}

export function page(config: Partial<PageConfig> = {}): PageConfig {
  return { size: 'a4', orient: 'portrait', bg: '#ffffff', grid: true, ...config };
}
